// Admission to a paid room. Two proofs: the joining socket controls the account (NEP-413 join
// signed by the quick-play session key) and the account holds an unassigned ticket on the contract
// (made by enter_arena; the stake already sits in it, so nothing is charged here).
// Colyseus fixes join options before it picks a room, so the client cannot sign the room id: the
// message is bound to the mode instead, and a timestamped one-use nonce (60 s) stops replays.
import { isValidAccountId, verifyNep413Signature } from "near-kit";
import { log } from "../obs";
import { sharedChain } from "../settlement";
import { assertStakeMatches } from "../settlement/stake";
import type { Chain } from "../settlement/chain";

interface Ticket {
  match_id: string | null;
}

export interface SignedJoin {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
  message: string;
}

const MAX_AGE_MS = 60_000;
/** The exact signed text, rebuilt server side (same shape as the client's joinMessage). */
export const joinMessage = (scope: string, accountId: string) => `margin-join:${scope}:${accountId}`;

// nonce (base64) -> first seen ms. Anything older than MAX_AGE_MS is rejected by the timestamp anyway.
const seen = new Map<string, number>();
function useNonce(nonce: string, nowMs: number): boolean {
  for (const [n, t] of seen) if (nowMs - t > MAX_AGE_MS) seen.delete(n);
  if (seen.has(nonce)) return false;
  seen.set(nonce, nowMs);
  return true;
}

/** Throws unless `join` is a fresh, unused NEP-413 signature by a key of `accountId` that may act on the contract. */
export async function verifyJoin(chain: Chain, join: unknown, nowMs = Date.now()): Promise<string> {
  const j = join as Partial<SignedJoin> | null;
  if (!j || typeof j !== "object") throw new Error("paid join must be signed");
  const { accountId, publicKey, signature, nonce } = j;
  if (typeof accountId !== "string" || !isValidAccountId(accountId)) throw new Error("paid mode needs a NEAR accountId");
  if (typeof publicKey !== "string" || typeof signature !== "string" || typeof nonce !== "string") throw new Error("bad join proof");
  const nonceBytes = Buffer.from(nonce, "base64");
  if (nonceBytes.length !== 32) throw new Error("bad join nonce");
  const ok = await verifyNep413Signature(
    { accountId, publicKey, signature },
    { message: joinMessage("paid", accountId), recipient: chain.cfg.contractId, nonce: nonceBytes },
    { maxAge: MAX_AGE_MS },
  ).catch(() => false);
  if (!ok) throw new Error("join signature invalid or expired");
  // No `near` option above: near-kit's own key check demands FullAccess and would refuse session keys.
  const key = await chain.accessKey(accountId, publicKey).catch(() => null);
  const p = key?.permission as unknown;
  const fc = typeof p === "object" && p !== null ? (p as { FunctionCall?: { receiver_id: string } }).FunctionCall : undefined;
  if (p !== "FullAccess" && fc?.receiver_id !== chain.cfg.contractId) throw new Error("join key is not a key of this account");
  // Key on the canonical bytes: base64 decoding is lenient, so two spellings can mean one nonce.
  if (!useNonce(nonceBytes.toString("base64"), nowMs)) throw new Error("join proof already used");
  return accountId;
}

/** Paid accounts seated in any live room on this process: one ticket, one room. */
export const seatedAccounts = new Set<string>();

/** The joining NEAR account; throws (join refused) without a valid join proof and a live, unassigned ticket. */
export async function admitPaid(opts: unknown): Promise<{ accountId: string }> {
  const chain = sharedChain();
  if (!chain) throw new Error("paid mode is off on this server");
  await assertStakeMatches(chain);
  const accountId = await verifyJoin(chain, (opts as { join?: unknown } | null)?.join);
  const t = await chain.view<Ticket | null>("ticket_of", { account_id: accountId });
  if (!t) throw new Error("no ticket: enter the arena first (1 USDC)");
  if (t.match_id) throw new Error("ticket already in a match");
  return { accountId };
}

/** Settler refunds for a room that never started (open_match failed, so tickets are unbound). */
export async function refundTickets(accounts: string[]): Promise<void> {
  const chain = sharedChain();
  if (!chain) return;
  for (const account_id of accounts) {
    await chain.call("refund_ticket", { account_id }).catch((err: unknown) => log.error("refund_failed", { account: account_id, err }));
  }
}
