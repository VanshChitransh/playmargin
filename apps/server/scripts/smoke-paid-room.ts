// Paid room gate on TESTNET (never mainnet), ~2 min: two real accounts buy 1 USDC tickets, join a
// paid room with NEP-413 signed joins, start early, and play the 90 s match. Checks: an unsigned
// join is refused, the room gets min(3, ceil(2/3)) = 1 labelled drone, and the match ends Settled
// on chain. Keys from ~/.near-credentials/testnet. Server must run with CONTRACT_ID/SETTLER_* env.
// Usage: npx tsx apps/server/scripts/smoke-paid-room.ts ws://localhost:2611
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Client } from "@colyseus/sdk";
import { Near, generateNonce, parseKey, type PrivateKey } from "near-kit";

const CONTRACT = "playmargin.testnet";
const USDC = "usdc.playmargin.testnet";
const STAKE = "1000000";
const PLAYERS = ["player1.playmargin.testnet", "owner.playmargin.testnet"];
const key = (id: string) => (JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")) as { private_key: string }).private_key;
const near = (id: string) => new Near({ network: "testnet", privateKey: key(id) as PrivateKey, defaultSignerId: id });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opt = { gas: "100 Tgas", waitUntil: "FINAL" } as const;

async function ticket(id: string): Promise<void> {
  const n = near(id);
  if (await n.view(CONTRACT, "ticket_of", { account_id: id })) return;
  if (BigInt((await n.view<string>(CONTRACT, "balance_of", { account_id: id })) ?? "0") < BigInt(STAKE)) {
    await near(CONTRACT).call(USDC, "mint", { account_id: id, amount: STAKE }, opt);
    await n.call(USDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: STAKE, msg: "" }, { ...opt, attachedDeposit: "1 yocto" });
  }
  await n.call(CONTRACT, "enter_arena", { stake: STAKE }, opt);
}

function signedJoin(id: string) {
  const nonce = generateNonce();
  const s = parseKey(key(id)).signNep413Message!(id, { message: `margin-join:paid:${id}`, recipient: CONTRACT, nonce });
  return { accountId: id, publicKey: s.publicKey, signature: s.signature, nonce: Buffer.from(nonce).toString("base64") };
}

for (const id of PLAYERS) await ticket(id);
console.log("tickets ready");
const sdk = new Client(process.argv[2] ?? "ws://localhost:2567");
const unsigned = await sdk.joinOrCreate("match", { mode: "paid", accountId: PLAYERS[0] }).then(() => "joined", () => "refused");
const rooms = [];
for (const id of PLAYERS) {
  const r = await sdk.joinOrCreate("match", { mode: "paid", join: signedJoin(id) });
  r.onMessage("ev", () => {});
  r.onMessage("me", () => {});
  rooms.push(r);
}
await sleep(8_500);
rooms[0]!.send("startNow");
await sleep(5_000);
type St = { phase: string; blobs: Map<string, { kind: string; label: string }> };
const st = rooms[0]!.state as unknown as St;
const drones = [...st.blobs.values()].filter((b) => b.kind === "drone").map((b) => b.label);
console.log({ unsigned, sameRoom: rooms[0]!.roomId === rooms[1]!.roomId, phase: st.phase, drones });
// Play it out: steer in circles, BOOST now and then, so the drone has something to hunt.
let t = 0;
const iv = setInterval(() => {
  t++;
  rooms.forEach((r, i) => r.send("input", { seq: t, dirX: Math.cos(t / 10 + i * 3), dirY: Math.sin(t / 10 + i * 3), boost: t % 40 === 5, repay: false, cashout: false }));
}, 100);
const matchId = rooms[0]!.roomId;
let status = "";
for (let i = 0; i < 40 && status !== "Settled"; i++) {
  await sleep(5_000);
  const m = await near(PLAYERS[0]!).view<{ status: string }>(CONTRACT, "match_of", { match_id: matchId }).catch(() => null);
  status = m?.status ?? "none";
}
clearInterval(iv);
console.log({ matchId, onChain: status });
const ok = unsigned === "refused" && rooms[0]!.roomId === rooms[1]!.roomId && drones.length === 1 && drones[0] === "Drone-1 (liquidator)" && status === "Settled";
console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
