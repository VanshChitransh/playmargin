// NEP-366 relayer: POST /relay {payload} wraps a player's signed enter_arena in a tx we pay gas
// for, and returns the contract's EVENT_JSON logs so the game server sees the "enter" event
// without an indexer. Pattern from near-api-examples meta-tx/server.ts, rewritten on near-kit.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { Near, decodeSignedDelegateAction } from "near-kit";
import { FileKeyStore } from "near-kit/keys/file";
import { RateLimit, refuseReason, type Policy } from "./validate.ts";

const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
const RELAYER_ID = process.env.RELAYER_ID ?? `relayer.playmargin.${NETWORK === "mainnet" ? "near" : "testnet"}`;
const PORT = Number(process.env.RELAYER_PORT ?? 3030);
const ORIGIN = process.env.RELAYER_CORS_ORIGIN ?? "*";
/** Below this balance (NEAR) /health reports an alarm: top the relayer up. */
const LOW_BALANCE = Number(process.env.RELAYER_LOW_BALANCE ?? 0.5);

const policy: Policy = {
  contractId: process.env.CONTRACT_ID ?? (NETWORK === "mainnet" ? "playmargin.near" : "playmargin.testnet"),
  methods: ["enter_arena"],
  maxGas: 30_000_000_000_000n,
};

// On the server the key comes from env; locally from ~/.near-credentials like every script.
const near = process.env.RELAYER_PRIVATE_KEY
  ? new Near({ network: NETWORK, privateKey: process.env.RELAYER_PRIVATE_KEY as `ed25519:${string}`, defaultSignerId: RELAYER_ID })
  : new Near({ network: NETWORK, keyStore: new FileKeyStore(join(homedir(), ".near-credentials"), NETWORK) });

const limiter = new RateLimit(Number(process.env.RELAYER_WINDOW_MS ?? 2_000));

function reply(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": ORIGIN,
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<{ payload?: unknown }> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error("body too large");
  }
  return JSON.parse(raw) as { payload?: unknown };
}

type Outcome = {
  transaction: { hash: string };
  status: unknown;
  receipts_outcome: Array<{ outcome: { logs: string[] } }>;
};

async function relay(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: unknown;
  try {
    payload = (await readJson(req)).payload;
  } catch {
    return reply(res, 400, { error: "bad json" });
  }
  if (typeof payload !== "string") return reply(res, 400, { error: "payload must be a base64 string" });
  let decoded;
  try {
    decoded = decodeSignedDelegateAction(payload);
  } catch {
    return reply(res, 400, { error: "not a signed delegate action" });
  }
  const why = refuseReason(decoded.signedDelegate, policy);
  if (why) return reply(res, 400, { error: why });
  const sender = decoded.signedDelegate.delegateAction.senderId;
  if (!limiter.allow(sender, Date.now())) return reply(res, 429, { error: "slow down" });

  try {
    const r = (await near.transaction(RELAYER_ID).signedDelegateAction(decoded).send({ waitUntil: "FINAL" })) as unknown as Outcome;
    const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
    const failed = JSON.stringify(r.status).includes("Failure") || JSON.stringify(r.receipts_outcome).includes("Failure");
    reply(res, failed ? 422 : 200, { ok: !failed, hash: r.transaction.hash, logs });
  } catch (e) {
    reply(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function health(res: ServerResponse): Promise<void> {
  const balance = Number(await near.getBalance(RELAYER_ID));
  reply(res, 200, { relayer: RELAYER_ID, contract: policy.contractId, balance, alarm: balance < LOW_BALANCE });
}

createServer((req, res) => {
  if (req.method === "OPTIONS") return reply(res, 204, {});
  if (req.method === "POST" && req.url === "/relay") return void relay(req, res);
  if (req.method === "GET" && req.url === "/health") return void health(res).catch(() => reply(res, 502, {}));
  reply(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`relayer ${RELAYER_ID} -> ${policy.contractId} on :${PORT} (${NETWORK})`));
