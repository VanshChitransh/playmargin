// Runs the browser chain module (apps/client/src/chain) against testnet + a local relayer, with
// player1's full key standing in for the wallet's one-time AddKey approval. Proves the exact code
// the client ships can buy a ticket with a session key. Start services/relayer first.

import { strict as assert } from "node:assert";
import { generateKey } from "near-kit";
import { balanceOf, ticketOf } from "../../apps/client/src/chain/funds.ts";
import { enterArena } from "../../apps/client/src/chain/session.ts";
import { IDS, NETWORK, near } from "./net.ts";

if (NETWORK !== "testnet") throw new Error("testnet only");
const { player, contract, usdc, settler } = IDS;
const fin = { waitUntil: "FINAL" } as const;

// Faucet as a non-owner (the player itself), then deposit, exactly like the UI buttons.
if ((await balanceOf(player)) < 1_000_000n) {
  await near.call(usdc, "mint", { account_id: player, amount: "10000000" }, { signerId: player, ...fin });
  const args = { receiver_id: contract, amount: "2000000", msg: "" };
  await near.call(usdc, "ft_transfer_call", args, { signerId: player, gas: "100 Tgas", attachedDeposit: "1 yocto", ...fin });
}
const before = await balanceOf(player);

const key = generateKey();
await near
  .transaction(player)
  .addKey(key.publicKey.toString(), { type: "functionCall", receiverId: contract, methodNames: ["enter_arena"], allowance: "0.05 NEAR" })
  .send(fin);

const r = await enterArena(player, key.secretKey as `ed25519:${string}`);
assert.ok(r.ok, JSON.stringify(r));
assert.ok(await ticketOf(player), "ticket visible to the client");
assert.equal(await balanceOf(player), before - 1_000_000n, "stake left the idle balance");
console.log(`CLIENT CHAIN CHECK PASS: https://testnet.nearblocks.io/txns/${r.hash}`);

await near.call(contract, "refund_ticket", { account_id: player }, { signerId: settler, ...fin });
