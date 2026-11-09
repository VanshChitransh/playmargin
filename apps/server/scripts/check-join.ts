// Live check of the paid join proof on testnet: signs as player1 with its real key and runs verifyJoin.
// Usage: npx tsx scripts/check-join.ts   (needs CONTRACT_ID/SETTLER_* env and ~/.near-credentials/testnet/player1.playmargin.testnet.json)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { generateNonce, parseKey } from "near-kit";
import { Chain, chainConfigFromEnv } from "../src/settlement/chain";
import { joinMessage, verifyJoin } from "../src/rooms/paidMatch";

const acc = "player1.playmargin.testnet";
const cfg = chainConfigFromEnv();
if (!cfg) throw new Error("set CONTRACT_ID, SETTLER_ID, SETTLER_PRIVATE_KEY");
const chain = new Chain(cfg);
const { private_key } = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${acc}.json`, "utf8"));
const nonce = generateNonce();
const s = parseKey(private_key).signNep413Message!(acc, { message: joinMessage("paid", acc), recipient: cfg.contractId, nonce });
const join = { accountId: acc, publicKey: s.publicKey, signature: s.signature, nonce: Buffer.from(nonce).toString("base64") };
console.log("valid join ->", await verifyJoin(chain, join));
console.log("replay ->", await verifyJoin(chain, join).catch((e: Error) => e.message));
console.log("claimed as settler ->", await verifyJoin(chain, { ...join, accountId: cfg.settlerId, nonce: Buffer.from(generateNonce()).toString("base64") }).catch((e: Error) => e.message));
