// near.social display names for verified NEAR accounts (paid seats). near.social is mainnet only
// (api2.near.social indexes the mainnet "social" account), so testnet accounts are never looked
// up. Every failure is silent: the seat just keeps its account name.
import { cleanName } from "@margin/core";

const API = "https://api2.near.social/v1/accounts/";
const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 1_500;

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
const cache = new Map<string, { name: string | null; at: number }>();

/** The cleaned near.social profile name of a mainnet account, or null (no profile, testnet, slow or down). */
export async function socialName(accountId: string, f: Fetch = fetch, now = Date.now()): Promise<string | null> {
  if (!accountId.endsWith(".near") && !/^[0-9a-f]{64}$/.test(accountId)) return null;
  const hit = cache.get(accountId);
  if (hit && now - hit.at < TTL_MS) return hit.name;
  let name: string | null = null;
  try {
    const r = await f(API + encodeURIComponent(accountId), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.ok) name = cleanName((await r.json() as { name?: unknown }).name);
  } catch {
    return null; // not cached: try again next join
  }
  cache.set(accountId, { name, at: now });
  return name;
}
