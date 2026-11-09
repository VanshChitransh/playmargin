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
// Players are never sub-accounts of the contract: their funding would come out of its storage headroom.
const PLAYERS = [IDS.player, process.env.PLAYER2_ID ?? "e2e2.playmargin.testnet"];
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
  const r = (await (await fetch("https://rpc.testnet.near.org", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as {
    result: { receipts_outcome: { outcome: { logs: string[] } }[] };
  };
  const line = r.result.receipts_outcome.flatMap((o) => o.outcome.logs).find((l) => l.includes('"event":"settle"'));
  assert.ok(line, "settle event in the settle tx");
  return (JSON.parse(line.slice("EVENT_JSON:".length)) as { data: Settle[] }).data[0]!;
}

/** A ticket still bound to a settling match blocks payToPlay: wait for the server's settle. */
async function ticketsFree(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const ts = await Promise.all(PLAYERS.map((p) => ticketOf(p)));
    if (ts.every((t) => !t || t.match_id === null)) return;
    await sleep(5_000);
  }
  throw new Error("tickets still in a match after 200 s");
}

async function oneMatch(run: number): Promise<void> {
  await ticketsFree();
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
    proof = (await fetch(`${HTTP}/api/matches/${id}/proof`).then((r) => r.json()).catch(() => ({}))) as typeof proof;
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

// No survivors (core 8269608): payouts [], the leftover pot rides in interest_to_vault. Real
// tickets, real settler, shape exactly as core emits it. Vault grows by leftover + fees.
{
  await ticketsFree();
  await Promise.all(PLAYERS.map((p) => payToPlay(p)));
  const id = `n8-wipe-${Date.now()}`;
  await near.call(contract, "open_match", { match_id: id, players: PLAYERS }, { signerId: settler, ...fin });
  type V = { free: string };
  const v0 = BigInt((await near.view<V>(contract, "vault", {}))!.free);
  const pot = 2n * stake;
  const fees = pot / 50n;
  const res = pot / 50n;
  const leftover = pot - fees - res;
  const r = await near.transaction(settler).functionCall(contract, "settle", {
    match_id: id, payouts: [], lent: "0", vault_repaid: "0", interest_to_vault: String(leftover),
    fees: String(fees), reserve: String(res), seq: 1, head: "n8-wipe",
  }, { gas: "100 Tgas" }).send(fin);
  const v1 = BigInt((await near.view<V>(contract, "vault", {}))!.free);
  assert.equal(v1, v0 + 3n * stake + leftover + fees, "budget back plus leftover plus fees");
  console.log(`ALL-POPPED PASS: ${link(r.transaction.hash)} vault +${leftover + fees} (leftover + fees)`);
}

// Stolen session key: it can buy tickets, never move money out.
const victim = PLAYERS[0]!;
const secret = store.get(`margin.session.testnet.${victim}`) as PrivateKey;
const thief = new Near({ network: "testnet", privateKey: secret, defaultSignerId: victim });
const bal = await balanceOf(victim);
const why = (e: Error & { data?: unknown }) => JSON.stringify(e.data ?? e.message);
// Expect InvalidAccessKeyError DepositWithFunctionCall, then MethodNameMismatch (protocol level).
const direct = await thief.call(contract, "withdraw", { amount: String(bal) }, { attachedDeposit: "1 yocto" }).then(() => "sent", why);
const noYocto = await thief.call(contract, "withdraw", { amount: String(bal) }).then(() => "sent", why);
const { payload } = await thief.transaction(victim).functionCall(contract, "withdraw", { amount: String(bal) }, { gas: "30 Tgas" }).delegate({ blockHeightOffset: 100 });
const relayed = await fetch(`${RELAYER}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
assert.notEqual(direct, "sent", "withdraw with 1 yocto refused for a function-call key");
assert.notEqual(noYocto, "sent", "withdraw without 1 yocto refused");
assert.equal(relayed.status, 400, "relayer refuses withdraw");
assert.equal(await balanceOf(victim), bal, "balance untouched");
console.log(`STOLEN KEY PASS: withdraw with 1 yocto ${direct}, without ${noYocto}, relayer ${relayed.status}`);
process.exit(0);
