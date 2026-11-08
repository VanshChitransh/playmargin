// Testnet money loop for N4: mint -> deposit -> vault seed -> enter -> open_match -> settle ->
// withdraw, asserting balances at each step and printing explorer links for the board.
// Run after deploy.ts: NETWORK=testnet npm run e2e (from tools/scripts).

import { strict as assert } from "node:assert";
import { ensureSubAccount } from "./keys.ts";
import { EXPLORER, IDS, NETWORK, near } from "./net.ts";

if (NETWORK !== "testnet") throw new Error("e2e mints mock USDC: testnet only");

const USDC = 1_000_000n;
const links: string[] = [];

type Outcome = { transaction: { hash: string } };

async function call(signer: string, to: string, method: string, args: object, yocto = false): Promise<void> {
  const r = (await near.call(to, method, args, {
    signerId: signer,
    gas: "100 Tgas",
    waitUntil: "FINAL",
    ...(yocto ? { attachedDeposit: "1 yocto" } : {}),
  })) as unknown as Outcome;
  links.push(`${method}: ${EXPLORER}/txns/${r.transaction.hash}`);
}

async function idle(who: string): Promise<bigint> {
  return BigInt(await near.view<string>(IDS.contract, "balance_of", { account_id: who }) ?? "0");
}

async function wallet(who: string): Promise<bigint> {
  return BigInt(await near.view<string>(IDS.usdc, "ft_balance_of", { account_id: who }) ?? "0");
}

/** ft_transfer_call into the margin contract. */
async function deposit(from: string, amount: bigint, msg: string): Promise<void> {
  await call(from, IDS.usdc, "ft_transfer_call", { receiver_id: IDS.contract, amount: String(amount), msg }, true);
}

const { player, owner, settler, contract } = IDS;
await ensureSubAccount(player, "0.5 NEAR");

// 1. Mint test USDC (the mock owner is the contract account).
for (const who of [player, owner]) await call(contract, IDS.usdc, "mint", { account_id: who, amount: String(10n * USDC) });

// 2. Owner seeds the vault so a match can be backed; player deposits 2 USDC.
await deposit(owner, 3n * USDC, JSON.stringify({ vault: true }));
const p0 = await idle(player);
await deposit(player, 2n * USDC, "");
assert.equal(await idle(player), p0 + 2n * USDC, "deposit credited");

// 3. Enter, open, settle. Pool = 1 stake + 1.5 budget = 2.5 USDC: player gets 0.7 back,
// vault 1.5 + 0.25 interest, reserve 0.05. Resumes a ticket/match left by an aborted run.
type Ticket = { match_id: string | null };
const ticket = await near.view<Ticket | null>(contract, "ticket_of", { account_id: player });
if (!ticket) await call(player, contract, "enter_arena", { stake: String(USDC) });
const matchId = ticket?.match_id ?? `e2e-${Date.now()}`;
if (!ticket?.match_id) await call(settler, contract, "open_match", { match_id: matchId, players: [player] });
const pBefore = await idle(player);
const vBefore = BigInt((await near.view<{ free: string }>(contract, "vault", {}))!.free);
await call(settler, contract, "settle", {
  match_id: matchId,
  payouts: [[player, "700000"]],
  vault_repaid: "1500000",
  interest_to_vault: "250000",
  reserve: "50000",
  seq: 1,
  head: "e2e",
});
assert.equal(await idle(player), pBefore + 700_000n, "payout credited");
const vAfter = BigInt((await near.view<{ free: string }>(contract, "vault", {}))!.free);
assert.equal(vAfter, vBefore + 1_500_000n + 250_000n, "vault whole plus interest");

// 4. Withdraw everything back to the wallet.
const w0 = await wallet(player);
const all = await idle(player);
await call(player, contract, "withdraw", { amount: String(all) }, true);
assert.equal(await wallet(player), w0 + all, "withdrawn to wallet");
assert.equal(await idle(player), 0n, "idle balance empty");

console.log("E2E PASS on testnet\n" + links.join("\n"));
