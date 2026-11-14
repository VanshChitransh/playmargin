// Gives the game server a settler key that can ONLY call open_match, settle, refund_ticket and anchor
// on the contract (RT L1-09, L8-03). A server compromise then gets those four calls, not the settler
// account (its NEAR, AddKey, DeleteAccount). The full key never goes to the server: it stays in
// ~/.near-credentials and the password manager, for top-ups and sweeps.
// No allowance on purpose: an allowance runs out and locks the server out mid-judging, and the
// settler's own balance (0.25 NEAR on mainnet) already bounds what the key can burn.
// The secret is written to ~/.near-credentials/<network>/<settler>.server-key.json (chmod 600) and
// never printed. Idempotent: run again and it only checks the key is on chain.
// Usage (tools/scripts): NETWORK=mainnet CONFIRM_MAINNET=yes CONTRACT_ID=<id> ../../node_modules/.bin/tsx settler-key.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateKey, parseKey } from "near-kit";
import { IDS, NETWORK, guardMainnet, near, txLink } from "./net.ts";

/** Every method the server signs as the settler (apps/server/src/settlement, anchor/job.ts, paidMatch.ts). */
export const SETTLER_METHODS = ["open_match", "settle", "refund_ticket", "anchor"];

guardMainnet();
const file = join(homedir(), ".near-credentials", NETWORK, `${IDS.settler}.server-key.json`);
const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { private_key: `ed25519:${string}` }).private_key : null;
const secret = saved ?? (generateKey().secretKey as `ed25519:${string}`);
const publicKey = parseKey(secret).publicKey.toString();
// Saved before the AddKey, like keys.ts: a crash never leaves a key on chain that nobody holds.
if (!saved) writeFileSync(file, JSON.stringify({ account_id: IDS.settler, public_key: publicKey, private_key: secret }) + "\n", { mode: 0o600 });

const onChain = await near.rpc.getAccessKey(IDS.settler, publicKey).catch(() => null);
if (onChain) {
  console.log(`already on chain: ${publicKey}`, JSON.stringify(onChain.permission));
} else {
  const r = await near
    .transaction(IDS.settler)
    .addKey(publicKey, { type: "functionCall", receiverId: IDS.contract, methodNames: SETTLER_METHODS })
    .send({ waitUntil: "FINAL" });
  console.log(`added ${publicKey} to ${IDS.settler} (${SETTLER_METHODS.join(", ")} on ${IDS.contract}): ${txLink(r)}`);
}
console.log(`server key file: ${file}`);
console.log(`to the server (nothing on the command line): jq -r '"SETTLER_PRIVATE_KEY=" + .private_key' ${file} | ssh <host> 'sudo tee -a /etc/margin/env >/dev/null'`);
