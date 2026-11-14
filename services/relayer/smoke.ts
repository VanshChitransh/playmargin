// Live check against a running relayer (testnet): a valid enter_arena is relayed and emits
// "enter"; a transfer, another receiver and a deposit > 0 get HTTP 400. Cleans up the ticket.
// Needs: relayer on RELAYER_URL. Tops player1 up with mock USDC when its idle balance is short.

import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { Near } from "near-kit";
import { FileKeyStore } from "near-kit/keys/file";

const URL_ = process.env.RELAYER_URL ?? "http://localhost:3030";
const PLAYER = "player1.playmargin.testnet";
const CONTRACT = "playmargin.testnet";
const near = new Near({ network: "testnet", keyStore: new FileKeyStore(join(homedir(), ".near-credentials"), "testnet") });

async function post(payload: string): Promise<{ status: number; body: { ok?: boolean; error?: string; logs?: string[]; hash?: string } }> {
  const r = await fetch(`${URL_}/relay`, { method: "POST", body: JSON.stringify({ payload }) });
  return { status: r.status, body: (await r.json()) as { ok?: boolean; error?: string; logs?: string[]; hash?: string } };
}

const idle = BigInt((await near.view<string>(CONTRACT, "balance_of", { account_id: PLAYER })) ?? "0");
if (idle < 1_000_000n) {
  const usdc = "usdc.playmargin.testnet";
  await near.call(usdc, "mint", { account_id: PLAYER, amount: "1000000" }, { signerId: CONTRACT, waitUntil: "FINAL" });
  const args = { receiver_id: CONTRACT, amount: "1000000", msg: "" };
  await near.call(usdc, "ft_transfer_call", args, { signerId: PLAYER, gas: "100 Tgas", attachedDeposit: "1 yocto", waitUntil: "FINAL" });
}

const tx = () => near.transaction(PLAYER);
const signed = async (b: ReturnType<typeof tx>) => (await b.delegate({ blockHeightOffset: 100 })).payload;

const bad = {
  transfer: await signed(tx().transfer(CONTRACT, "0.001 NEAR")),
  receiver: await signed(tx().functionCall("usdc.playmargin.testnet", "enter_arena", {}, { gas: "30 Tgas" })),
  deposit: await signed(tx().functionCall(CONTRACT, "enter_arena", { stake: "1000000" }, { gas: "30 Tgas", attachedDeposit: "1 yocto" })),
  // RT L3-01: calls the contract would refuse are refused here too, before any gas is paid.
  "wrong stake": await signed(tx().functionCall(CONTRACT, "enter_arena", { stake: "1" }, { gas: "30 Tgas" })),
};
for (const [name, payload] of Object.entries(bad)) {
  const r = await post(payload);
  assert.equal(r.status, 400, `${name} must be refused`);
  console.log(`refused ${name}: ${r.body.error}`);
}

const pause = () => new Promise((r) => setTimeout(r, 2_100)); // per-IP and per-key throttles
await pause();
const ok = await post(await signed(tx().functionCall(CONTRACT, "enter_arena", { stake: "1000000" }, { gas: "30 Tgas" })));
assert.equal(ok.status, 200, JSON.stringify(ok.body));
assert.ok(ok.body.logs?.some((l) => l.includes('"event":"enter"')), "enter event in logs");
console.log(`relayed enter_arena: https://testnet.nearblocks.io/txns/${ok.body.hash}`);
await pause();
const again = await post(await signed(tx().functionCall(CONTRACT, "enter_arena", { stake: "1000000" }, { gas: "30 Tgas" })));
assert.equal(again.status, 400, "a second ticket must be refused before paying");
console.log(`refused second ticket: ${again.body.error}`);

await near.call(CONTRACT, "refund_ticket", { account_id: PLAYER }, { signerId: "settler.playmargin.testnet", waitUntil: "FINAL" });
console.log("RELAYER SMOKE PASS (ticket refunded)");
