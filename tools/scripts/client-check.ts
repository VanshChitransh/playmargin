// Runs the browser chain module (apps/client/src/chain) against testnet + a local relayer, with
// player1's full key standing in for the wallet's one-time AddKey approval. Proves the exact code
// the client ships can buy a ticket with a session key. Start services/relayer first.

import { strict as assert } from "node:assert";
import { generateKey, verifyNep413Signature } from "near-kit";
import { balanceOf, ticketOf } from "../../apps/client/src/chain/funds.ts";
import { joinMessage } from "../../apps/client/src/chain/join.ts";
import { payToPlay } from "../../apps/client/src/chain/paid.ts";
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

// payToPlay exactly as the PLAY $1 button runs it. A localStorage shim holds the session key the
// wallet step would have stored, so sessionKey() finds it on chain and no pop-up is needed.
const store = new Map<string, string>([[`margin.session.testnet.${player}`, key.secretKey]]);
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
});
const steps: string[] = [];
const entry = await payToPlay(player, (s) => steps.push(s));
assert.deepEqual(steps, ["quick-play", "ticket", "ready"]);
assert.ok(entry.ticketTx, "payToPlay bought a ticket");
const j = entry.join("room-check");
const ok = await verifyNep413Signature(
  { accountId: j.accountId, publicKey: j.publicKey, signature: j.signature },
  { message: joinMessage("room-check", player), recipient: contract, nonce: Uint8Array.from(atob(j.nonce), (c) => c.charCodeAt(0)) },
  { maxAge: 60_000 },
);
assert.ok(ok, "join proof verifies like the server will");
console.log(`PAY TO PLAY PASS: https://testnet.nearblocks.io/txns/${entry.ticketTx}`);
await near.call(contract, "refund_ticket", { account_id: player }, { signerId: settler, ...fin });
