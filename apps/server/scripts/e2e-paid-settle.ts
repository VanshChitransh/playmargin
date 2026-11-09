// S6 gate on TESTNET (never mainnet): player1 buys a 1 USDC ticket, a real core match is played
// headless with BOOST taps, then NearSettlement runs open_match and settle on the contract.
// Checks: match Settled on chain with our head, player balance moved by exactly the payout.
// Keys come from ~/.near-credentials/testnet (player1, settler). Usage: npx tsx apps/server/scripts/e2e-paid-settle.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Near, type PrivateKey } from "near-kit";
import {
  MATCH_TICKS, drainLog, newWorld, settleVerified, startMatch, step, type InputCmd, type LogEntry,
} from "@margin/core";
import { Chain } from "../src/settlement/chain";
import { NearSettlement } from "../src/settlement/near";
import { toSettleArgs } from "../src/settlement/toSettleArgs";

const CONTRACT = "playmargin.testnet";
const PLAYER = "player1.playmargin.testnet";
const SETTLER = "settler.playmargin.testnet";
const key = (id: string) =>
  (JSON.parse(readFileSync(join(homedir(), ".near-credentials/testnet", `${id}.json`), "utf8")) as { private_key: string }).private_key;

const player = new Near({ network: "testnet", privateKey: key(PLAYER) as PrivateKey, defaultSignerId: PLAYER });
const chain = new Chain({ network: "testnet", contractId: CONTRACT, settlerId: SETTLER, privateKey: key(SETTLER), rpcUrls: ["https://rpc.testnet.fastnear.com"] });
const settlement = new NearSettlement(chain);
const balance = async () => BigInt((await chain.view<string>("balance_of", { account_id: PLAYER })) ?? "0");

const STAKE = 1_000_000n;
const hasTicket = !!(await chain.view("ticket_of", { account_id: PLAYER }));
// Expected balance is tracked from the starting read plus known flows: an RPC view right after
// a call can lag a block, so intermediate reads are never trusted.
const start = await balance();
let deposited = 0n;
if (!hasTicket && start < STAKE) {
  // Mock USDC only: the contract account mints, player1 deposits it into the arena.
  const minter = new Near({ network: "testnet", privateKey: key(CONTRACT) as PrivateKey, defaultSignerId: CONTRACT });
  await minter.call("usdc.playmargin.testnet", "mint", { account_id: PLAYER, amount: String(STAKE) }, { gas: "30 Tgas", waitUntil: "FINAL" });
  await player.call("usdc.playmargin.testnet", "ft_transfer_call", { receiver_id: CONTRACT, amount: String(STAKE), msg: "" }, { gas: "100 Tgas", attachedDeposit: "1 yocto", waitUntil: "FINAL" });
  deposited = STAKE;
  console.log("topped up 1 mock USDC");
}
if (!hasTicket) {
  const r = await player.call(CONTRACT, "enter_arena", { stake: String(STAKE) }, { gas: "30 Tgas", waitUntil: "FINAL" });
  console.log("enter_arena", (r as { transaction: { hash: string } }).transaction.hash);
}
const afterEntry = start + deposited - (hasTicket ? 0n : STAKE);

const matchId = `e2e-${Date.now().toString(36)}`;
const w = newWorld(Date.now() % 2 ** 31, "paid", [{ id: "p1", kind: "human", label: PLAYER, accountId: PLAYER }], matchId);
startMatch(w, 0);
await settlement.open({ matchId, mode: "paid", pot: w.pot, vaultBudget: w.vault.budget, players: [{ id: "p1", accountId: PLAYER, entry: w.pot }] });
console.log("open_match ok", matchId);

const log: LogEntry[] = [];
for (let t = 1; t <= MATCH_TICKS + 1 && w.phase !== "ENDED"; t++) {
  const a = t / 90;
  const cmd: InputCmd = { seq: t, dirX: Math.cos(a), dirY: Math.sin(a), boost: t % 600 >= 120 && t % 600 < 180, repay: t % 900 === 450, cashout: false };
  step(w, new Map([["p1", cmd]]), t);
  await drainLog(w, log);
}
const result = await settleVerified(log);
const args = toSettleArgs(result);
console.log("settle args", JSON.stringify({ ...args, head: args.head.slice(0, 12) }));
const tx = await settlement.settle(result, result.head);
console.log(`settle tx https://testnet.nearblocks.io/txns/${tx.hash}`);

const m = await chain.view<{ status: string; head: string }>("match_of", { match_id: matchId });
const after = await balance();
const paid = BigInt(args.payouts.find(([acc]) => acc === PLAYER)?.[1] ?? "0");
const again = await settlement.settle(result, result.head); // idempotent: must not send a second tx
const ok = m?.status === "Settled" && m.head === result.head && after - afterEntry === paid && again.hash === "";
console.log(JSON.stringify({ start: String(start), afterEntry: String(afterEntry), after: String(after), paid: String(paid), status: m?.status, entries: log.length }));
console.log(ok ? "E2E OK" : "E2E FAIL");
process.exit(ok ? 0 : 1);
