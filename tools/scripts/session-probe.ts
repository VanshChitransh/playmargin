// N7 open item (DEVELOPMENT.md section 13, item 2): can a function-call access key sign a NEP-366
// delegate for its own method, and does relaying consume the key's allowance? Also proves a
// session key cannot withdraw. Testnet only; prints the answers for PROBLEMS.md.

import { strict as assert } from "node:assert";
import { Near, decodeSignedDelegateAction, generateKey } from "near-kit";
import { IDS, NETWORK, near } from "./net.ts";

if (NETWORK !== "testnet") throw new Error("probe is testnet only");
const { player, contract, relayer, usdc, settler } = IDS;
const fin = { waitUntil: "FINAL" } as const;

// 1. Make sure the player can afford a ticket.
const idle = BigInt((await near.view<string>(contract, "balance_of", { account_id: player })) ?? "0");
if (idle < 1_000_000n) {
  await near.call(usdc, "mint", { account_id: player, amount: "1000000" }, { signerId: contract, ...fin });
  const args = { receiver_id: contract, amount: "1000000", msg: "" };
  await near.call(usdc, "ft_transfer_call", args, { signerId: player, gas: "100 Tgas", attachedDeposit: "1 yocto", ...fin });
}

// 2. Full key adds the session key: only enter_arena on our contract, explicit 0.05 NEAR allowance.
const session = generateKey();
const pk = session.publicKey.toString();
await near
  .transaction(player)
  .addKey(pk, { type: "functionCall", receiverId: contract, methodNames: ["enter_arena"], allowance: "0.05 NEAR" })
  .send(fin);
const allowance = async () => {
  const k = await near.getAccessKey(player, pk);
  return JSON.stringify(k?.permission);
};
const before = await allowance();

// 3. Session key signs a delegate; the relayer account submits it and pays gas.
const sessionNear = new Near({ network: "testnet", privateKey: session.secretKey as `ed25519:${string}`, defaultSignerId: player });
const signDelegate = async (method: string, args: object) =>
  (await sessionNear.transaction(player).functionCall(contract, method, args, { gas: "30 Tgas" }).delegate({ blockHeightOffset: 100 })).payload;
const relay = (payload: string) => near.transaction(relayer).signedDelegateAction(decodeSignedDelegateAction(payload)).send(fin);

const r = (await relay(await signDelegate("enter_arena", { stake: "1000000" }))) as unknown as { transaction: { hash: string } };
const ticket = await near.view(contract, "ticket_of", { account_id: player });
assert.ok(ticket, "ticket created through a function-call-key delegate");
const after = await allowance();
console.log(`ANSWER 1: function-call key CAN sign a NEP-366 delegate: https://testnet.nearblocks.io/txns/${r.transaction.hash}`);
console.log(`ANSWER 2: allowance before ${before}\n          allowance after  ${after}\n          consumed by relay: ${before !== after}`);

// 4. A stolen session key cannot withdraw: not via a delegate (method not allowed) ...
let refused = false;
try {
  const res = await relay(await signDelegate("withdraw", { amount: "1" }));
  refused = JSON.stringify(res).includes("Failure");
} catch {
  refused = true;
}
assert.ok(refused, "withdraw via session-key delegate must fail");
// ... nor directly (function-call keys cannot attach the 1 yocto withdraw requires).
let direct = false;
try {
  await sessionNear.call(contract, "withdraw", { amount: "1" }, { attachedDeposit: "1 yocto", ...fin });
} catch {
  direct = true;
}
assert.ok(direct, "direct withdraw with session key must fail");
console.log("ANSWER 3: session key cannot withdraw (delegate refused on chain, direct call refused)");

await near.call(contract, "refund_ticket", { account_id: player }, { signerId: settler, ...fin });
console.log("SESSION PROBE PASS");
