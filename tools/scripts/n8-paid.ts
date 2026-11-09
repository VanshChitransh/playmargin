// N8 gate on TESTNET: two separate clients (two "browsers") run the paid flow twice in a row
// through the shipped client chain code: payToPlay (session key, relayed ticket), a fresh NEP-413
// join per joinOrCreate, a real 90 s match on the game server, the server's settle, and each
// balance moving by exactly its on-chain payout. Then a stolen session key tries to withdraw.
// The full key stands in for the wallet's one approval (AddKey). Needs the game server and relayer:
//   GAME_WS=ws://localhost:2671 VITE_RELAYER_URL=... ../../node_modules/.bin/tsx n8-paid.ts

import { strict as assert } from "node:assert";
import { Client, type Room } from "@colyseus/sdk";
import { Near, generateKey, type PrivateKey } from "near-kit";
import { balanceOf, entryStake, ticketOf } from "../../apps/client/src/chain/funds.ts";
import { payToPlay } from "../../apps/client/src/chain/paid.ts";
import { IDS, NETWORK, near } from "./net.ts";
import { ensureSubAccount } from "./keys.ts";

if (NETWORK !== "testnet") throw new Error("testnet only");
const WS = process.env.GAME_WS ?? "ws://localhost:2671";
const HTTP = WS.replace(/^ws/, "http");
const RELAYER = process.env.VITE_RELAYER_URL ?? "http://localhost:3031";
const { contract, usdc, settler } = IDS;
const PLAYERS = [IDS.player, `e2e2.${contract}`];
const fin = { waitUntil: "FINAL" } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const link = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;

// Each player's session key, as the browser would hold it after the one wallet approval.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
});

const stake = BigInt(await entryStake());
for (const p of PLAYERS) {
  await ensureSubAccount(p, "0.5 NEAR");
  const t = await ticketOf(p);
  if (t && t.match_id === null) await near.call(contract, "refund_ticket", { account_id: p }, { signerId: settler, ...fin });
  if ((await balanceOf(p)) < 3n * stake) {
    await near.call(usdc, "mint", { account_id: p, amount: "10000000" }, { signerId: p, ...fin });
    const args = { receiver_id: contract, amount: String(3n * stake), msg: "" };
    await near.call(usdc, "ft_transfer_call", args, { signerId: p, gas: "100 Tgas", attachedDeposit: "1 yocto", ...fin });
  }
  const key = generateKey();
  const perm = { type: "functionCall" as const, receiverId: contract, methodNames: ["enter_arena"], allowance: "0.05 NEAR" as const };
  await near.transaction(p).addKey(key.publicKey.toString(), perm).send(fin);
  store.set(`margin.session.testnet.${p}`, key.secretKey);
}

type Settle = { payouts: [string, string][] };
async function settleEvent(hash: string): Promise<Settle> {
  const body = { jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: settler, wait_until: "FINAL" } };
  const r = (await (await fetch("https://rpc.testnet.near.org", { method: "POST", body: JSON.stringify(body) })).json()) as {
    result: { receipts_outcome: { outcome: { logs: string[] } }[] };
  };
  const line = r.result.receipts_outcome.flatMap((o) => o.outcome.logs).find((l) => l.includes('"event":"settle"'));
  assert.ok(line, "settle event in the settle tx");
  return (JSON.parse(line.slice("EVENT_JSON:".length)) as { data: Settle[] }).data[0]!;
}

async function oneMatch(run: number): Promise<void> {
  const before = await Promise.all(PLAYERS.map((p) => balanceOf(p)));
  const entries = await Promise.all(PLAYERS.map((p) => payToPlay(p)));
  // Two clients, two sockets: what two browsers do.
  const rooms: Room[] = [];
  for (const [i, p] of PLAYERS.entries()) {
    const r = await new Client(WS).joinOrCreate("match", { mode: "paid", accountId: p, join: entries[i]!.join() });
    for (const t of ["ev", "me", "aborted"]) r.onMessage(t, () => {});
    rooms.push(r);
  }
  assert.equal(rooms[0]!.roomId, rooms[1]!.roomId, "both players seated in one paid room");
  await sleep(8_500);
  rooms[0]!.send("startNow");
  let t = 0;
  const iv = setInterval(() => {
    t++;
    rooms.forEach((r, i) => r.send("input", { seq: t, dirX: Math.cos(t / 9 + i * 3), dirY: Math.sin(t / 9 + i * 3), boost: t % 45 === 7, repay: false, cashout: false }));
  }, 100);
  const id = rooms[0]!.roomId;
  let proof: { status?: string; settleTx?: string | null } = {};
  for (let i = 0; i < 48 && !proof.settleTx; i++) {
    await sleep(5_000);
    proof = (await fetch(`${HTTP}/api/match/${id}/proof`).then((r) => r.json(), () => ({}))) as typeof proof;
  }
  clearInterval(iv);
  rooms.forEach((r) => void r.leave());
  assert.ok(proof.settleTx, `match ${id} settled (proof ${JSON.stringify(proof)})`);
  const hash = /[1-9A-HJ-NP-Za-km-z]{43,44}/.exec(proof.settleTx)![0];
  const ev = await settleEvent(hash);
  const after = await Promise.all(PLAYERS.map((p) => balanceOf(p)));
  for (const [i, p] of PLAYERS.entries()) {
    const paid = BigInt(ev.payouts.find(([a]) => a === p)?.[1] ?? "0");
    assert.equal(after[i], before[i]! - stake + paid, `${p}: balance = before - stake + on-chain payout`);
  }
  console.log(`RUN ${run} PASS match ${id}`);
  entries.forEach((e, i) => console.log(`  ticket ${PLAYERS[i]}: ${e.ticketTx ? link(e.ticketTx) : "reused"}`));
  console.log(`  settle: ${link(hash)} payouts ${JSON.stringify(ev.payouts)}`);
}

await oneMatch(1);
await oneMatch(2);

// Stolen session key: it can buy tickets, never move money out.
const victim = PLAYERS[0]!;
const secret = store.get(`margin.session.testnet.${victim}`) as PrivateKey;
const thief = new Near({ network: "testnet", privateKey: secret, defaultSignerId: victim });
const bal = await balanceOf(victim);
const direct = await thief.call(contract, "withdraw", { amount: String(bal) }, { attachedDeposit: "1 yocto" }).then(() => "sent", (e: Error) => e.message);
const noYocto = await thief.call(contract, "withdraw", { amount: String(bal) }).then(() => "sent", (e: Error) => e.message);
const { payload } = await thief.transaction(victim).functionCall(contract, "withdraw", { amount: String(bal) }, { gas: "30 Tgas" }).delegate({ blockHeightOffset: 100 });
const relayed = await fetch(`${RELAYER}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
assert.notEqual(direct, "sent", "withdraw with 1 yocto refused for a function-call key");
assert.notEqual(noYocto, "sent", "withdraw without 1 yocto refused");
assert.equal(relayed.status, 400, "relayer refuses withdraw");
assert.equal(await balanceOf(victim), bal, "balance untouched");
console.log(`STOLEN KEY PASS: direct withdraw refused (${direct.slice(0, 80)}), no-deposit refused (${noYocto.slice(0, 60)}), relayer ${relayed.status}`);
process.exit(0);
