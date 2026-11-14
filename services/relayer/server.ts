// NEP-366 relayer: POST /relay {payload} wraps a player's signed enter_arena in a tx we pay gas
// for, and returns the contract's EVENT_JSON logs so the game server sees the "enter" event
// without an indexer. Pattern from near-api-examples meta-tx/server.ts, rewritten on near-kit.
// Also proxies 1-Click Add funds (/tokens, /quote, /status) so the partner JWT stays server side,
// and pays for NEAR Auth email accounts (/fastauth/create, /fastauth/sign, see fastauth.ts).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeSignedDelegateAction } from "near-kit";
import { FileKeyStore } from "near-kit/keys/file";
import { accessKey, nearClients, withFallback } from "../../apps/client/src/chain/rpc.ts";
import { createError, signError } from "./fastauth.ts";
import * as oneclick from "./oneclick.ts";
import { KeyedCap, WindowCap, RateLimit, delegateKey, entryRefusal, keyRefusal, refuseReason, signatureOk, type KeyView, type Policy } from "./validate.ts";

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
// RPC_URLS (comma list) goes first, then FastNEAR, then NEAR's own RPC (apps/client/src/chain/rpc.ts).
const clients = nearClients(
  NETWORK,
  process.env.RPC_URLS,
  process.env.RELAYER_PRIVATE_KEY
    ? { privateKey: process.env.RELAYER_PRIVATE_KEY as `ed25519:${string}`, defaultSignerId: RELAYER_ID }
    : { keyStore: new FileKeyStore(join(homedir(), ".near-credentials"), NETWORK) },
);
/** Next RPC only when one is unreachable, so a tx is never sent twice (see withFallback). */
const rpc = <T>(fn: (near: (typeof clients)[number]) => Promise<T>): Promise<T> => withFallback(clients, fn);

const limiter = new RateLimit(Number(process.env.RELAYER_WINDOW_MS ?? 2_000));
const ipLimiter = new RateLimit(Number(process.env.RELAYER_IP_WINDOW_MS ?? 1_000));
/** Paid relays per minute and per UTC day: at ~0.0002 NEAR each, a day costs at most ~0.4 NEAR. */
const perMinute = new WindowCap(Number(process.env.RELAYER_MINUTE_CAP ?? 60), 60_000);
const perDay = new WindowCap(Number(process.env.RELAYER_DAILY_CAP ?? 2_000), 86_400_000);
/** Per sender and per IP per UTC day, far below the global caps: one account or one IP cannot shut
 * paid entry for everyone (RT L3-01). A match is ~2 min, so 20 tickets a day is a long session. */
const senderDay = new KeyedCap(Number(process.env.RELAYER_SENDER_DAILY_CAP ?? 20), 86_400_000);
const ipDay = new KeyedCap(Number(process.env.RELAYER_IP_DAILY_CAP ?? 40), 86_400_000);

function reply(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": ORIGIN,
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error("body too large");
  }
  return JSON.parse(raw) as Record<string, unknown>;
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
  } catch (err) {
    if (err instanceof Error && err.message === "body too large") return reply(res, 413, { error: "body too large" });
    return reply(res, 400, { error: "bad json" });
  }
  if (typeof payload !== "string") return reply(res, 400, { error: "payload must be a base64 string" });
  let decoded;
  try {
    decoded = decodeSignedDelegateAction(payload);
  } catch {
    return reply(res, 400, { error: "not a signed delegate action" });
  }
  const sd = decoded.signedDelegate;
  const why = refuseReason(sd, policy);
  if (why) return reply(res, 400, { error: why });
  // Everything below is free for us: a forged or replayed delegate never becomes a paid tx.
  if (!signatureOk(payload, sd)) return reply(res, 400, { error: "bad signature" });
  const now = Date.now();
  if (!ipLimiter.allow(ip(req), now)) return reply(res, 429, { error: "slow down" });
  const sender = sd.delegateAction.senderId;
  const pk = delegateKey(sd)!;
  const fc = sd.delegateAction.actions[0]!;
  const method = "functionCall" in fc ? fc.functionCall.methodName : "";
  const view = <T>(m: string, args: object) => rpc((n) => n.view<T>(policy.contractId, m, args));
  let checks;
  try {
    checks = await Promise.all([
      rpc((n) => accessKey(n, sender, pk)),
      rpc((n) => n.getStatus()),
      view<{ entry_stake: string }>("config", {}),
      view<string>("balance_of", { account_id: sender }),
      view<unknown>("ticket_of", { account_id: sender }),
    ]);
  } catch {
    // Fail closed: if we cannot prove the call will succeed, we do not pay for it.
    return reply(res, 503, { error: "cannot reach NEAR to check your ticket, try again in a moment" });
  }
  const [key, status, config, balance, ticket] = checks;
  const height = BigInt(status.sync_info.latest_block_height);
  const refusal =
    keyRefusal(sd, key as KeyView | null, height, policy.contractId, method) ??
    ("functionCall" in fc ? entryRefusal(fc.functionCall.args, String(config?.entry_stake), String(balance ?? "0"), ticket) : "only function calls");
  if (refusal) return reply(res, 400, { error: refusal });
  if (!limiter.allow(`${sender}/${pk}`, now)) return reply(res, 429, { error: "slow down" });
  if (!senderDay.take(sender, now) || !ipDay.take(ip(req), now)) return reply(res, 429, { error: "daily ticket limit reached, try again tomorrow" });
  if (!perMinute.take(now) || !perDay.take(now)) return reply(res, 503, { error: "relayer busy, try again in a minute" });

  try {
    const r = (await rpc((n) => n.transaction(RELAYER_ID).signedDelegateAction(decoded).send({ waitUntil: "FINAL" }))) as unknown as Outcome;
    const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
    const failed = JSON.stringify(r.status).includes("Failure") || JSON.stringify(r.receipts_outcome).includes("Failure");
    reply(res, failed ? 422 : 200, { ok: !failed, hash: r.transaction.hash, logs });
  } catch (e) {
    reply(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

const quoteLimiter = new RateLimit(1_000);
// B04/B05: the accountId is the client's choice, so the IP limits too; /status was not limited at all.
const quoteIpLimiter = new RateLimit(1_000);
const statusIpLimiter = new RateLimit(500);
/** 1-Click deposit addresses: NEAR, EVM, base58, bech32. Anything else never reaches 1-Click. */
const DEPOSIT_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/** POST /quote {accountId, originAsset, amount, refundTo}: 1-Click quote into the contract. */
async function quote(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch {
    return reply(res, 400, { error: "bad json" });
  }
  const known = new Set((await oneclick.tokens()).map((t) => t.assetId));
  const why = oneclick.quoteInputError(body, (id) => known.has(id));
  if (why) return reply(res, 400, { error: why });
  if (!quoteIpLimiter.allow(ip(req), Date.now()) || !quoteLimiter.allow(String(body.accountId), Date.now())) return reply(res, 429, { error: "slow down" });
  const r = await oneclick.quote(body as unknown as oneclick.QuoteInput);
  reply(res, r.status, r.body as object);
}

const REGISTRAR = NETWORK === "mainnet" ? "near" : "testnet";
const FAST_AUTH = NETWORK === "mainnet" ? "fast-auth.near" : "fast-auth.testnet";
const GUARD = `jwt#https://${NETWORK === "mainnet" ? "login.auth.near.org" : "login.testnet.fast-auth.com"}/`;
const USDC = process.env.USDC_ID ?? (NETWORK === "mainnet" ? oneclick.USDC_NEAR.slice(7) : "usdc.playmargin.testnet");
/** NEAR each new email account gets for its own few full-key txs (session key, deposit, withdraw). */
const FUND = `${Number(process.env.FASTAUTH_FUND ?? 0.01)} NEAR` as const;
// ponytail: per-IP limits + a daily cap; verify the Auth0 JWT here (JWKS) if bots farm accounts.
const createLimiter = new RateLimit(60_000);
const signLimiter = new RateLimit(3_000);
const daily = { day: "", n: 0, cap: Number(process.env.FASTAUTH_DAILY_CAP ?? 200) };
/** Email login spends relayer NEAR per call: off until NEAR approves our Auth0 app and JWTs are
 * verified here (CSO H2/M3). Until then the routes answer 404. */
const FASTAUTH = process.env.FASTAUTH_ENABLED === "1";
const ip = (req: IncomingMessage) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0] ?? "?";

/** POST /fastauth/create {accountId, publicKey}: registrar create_account, funded with FUND. */
async function fastauthCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const b = await readJson(req);
  const why = createError(b, REGISTRAR);
  if (why) return reply(res, 400, { error: why });
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) Object.assign(daily, { day: today, n: 0 });
  if (daily.n >= daily.cap || !createLimiter.allow(ip(req), Date.now())) return reply(res, 429, { error: "slow down" });
  daily.n++;
  const args = { new_account_id: b.accountId, new_public_key: b.publicKey };
  const r = (await rpc((n) =>
    n.transaction(RELAYER_ID).functionCall(REGISTRAR, "create_account", args, { gas: "50 Tgas", attachedDeposit: FUND }).send({ waitUntil: "FINAL" }),
  )) as unknown as Outcome;
  const failed = JSON.stringify(r.receipts_outcome).includes("Failure");
  reply(res, failed ? 422 : 200, { ok: !failed, hash: r.transaction.hash });
}

/** POST /fastauth/sign {guardId, verifyPayload, signPayload}: MPC signs after the JWT checks out. */
async function fastauthSign(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const b = await readJson(req);
  const why = signError(b, GUARD, [policy.contractId, USDC]);
  if (why) return reply(res, 400, { error: why });
  if (!signLimiter.allow(ip(req), Date.now())) return reply(res, 429, { error: "slow down" });
  const args = { guard_id: b.guardId, verify_payload: b.verifyPayload, sign_payload: b.signPayload, algorithm: "eddsa" };
  const r = (await rpc((n) =>
    n.transaction(RELAYER_ID).functionCall(FAST_AUTH, "sign", args, { gas: "300 Tgas", attachedDeposit: "1 yocto" }).send({ waitUntil: "FINAL" }),
  )) as unknown as Outcome & { status: { SuccessValue?: string } };
  const signature = r.status.SuccessValue;
  if (!signature) return reply(res, 422, { error: "MPC did not sign", hash: r.transaction.hash });
  reply(res, 200, { signature, hash: r.transaction.hash });
}

async function health(res: ServerResponse): Promise<void> {
  const balance = Number(await rpc((n) => n.getBalance(RELAYER_ID)));
  // Alarm also when a relay cap refused someone in the last 10 min (flood, or real demand to raise caps).
  const capped = Date.now() - Math.max(perMinute.hitAt, perDay.hitAt) < 600_000;
  reply(res, 200, { relayer: RELAYER_ID, contract: policy.contractId, balance, capped, alarm: balance < LOW_BALANCE || capped });
}

createServer((req, res) => {
  if (req.method === "OPTIONS") return reply(res, 204, {});
  if (req.method === "POST" && req.url === "/relay") return void relay(req, res).catch((e) => reply(res, 502, { error: String(e) }));
  const err = (e: unknown) => reply(res, 502, { error: e instanceof Error ? e.message : String(e) });
  if (FASTAUTH && req.method === "POST" && req.url === "/fastauth/create") return void fastauthCreate(req, res).catch(err);
  if (FASTAUTH && req.method === "POST" && req.url === "/fastauth/sign") return void fastauthSign(req, res).catch(err);
  if (req.method === "GET" && req.url === "/health") return void health(res).catch(() => reply(res, 502, {}));
  const fail = () => reply(res, 502, { error: "1-Click unavailable" });
  if (req.method === "GET" && req.url === "/tokens") return void oneclick.tokens().then((t) => reply(res, 200, t), fail);
  if (req.method === "POST" && req.url === "/quote") return void quote(req, res).catch(fail);
  const st = req.method === "GET" && req.url?.startsWith("/status?") ? new URL(req.url, "http://x").searchParams.get("depositAddress") : null;
  if (st && !DEPOSIT_RE.test(st)) return reply(res, 400, { error: "bad depositAddress" });
  if (st && !statusIpLimiter.allow(ip(req), Date.now())) return reply(res, 429, { error: "slow down" });
  if (st) return void oneclick.status(st).then((r) => reply(res, r.status, r.body as object), fail);
  reply(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`relayer ${RELAYER_ID} -> ${policy.contractId} on :${PORT} (${NETWORK})`));
