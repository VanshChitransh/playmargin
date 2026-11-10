// near.social profiles (name, avatar, page link) for a signed-in player's own account. near.social
// is mainnet only, so a testnet build never asks and every caller falls back to the account name.
import { NETWORK } from "../chain/config";

export const SOCIAL_API = "https://api2.near.social/v1";
/** True when this build can read and post on near.social (mainnet builds only). */
export const SOCIAL_ON = NETWORK === "mainnet";

export interface SocialProfile {
  accountId: string;
  name: string | null;
  avatarUrl: string | null;
  /** The profile page on near.social. */
  url: string;
}

export const profileUrl = (accountId: string): string => `https://near.social/${encodeURIComponent(accountId)}`;
export const postUrl = (accountId: string, postId: string): string => `https://near.social/${encodeURIComponent(accountId)}/post/${postId}`;

const cache = new Map<string, Promise<SocialProfile | null>>();

/** The near.social profile of a mainnet account, or null (testnet build, no profile, or the API is down). */
export function socialProfile(accountId: string, f: typeof fetch = fetch, on = SOCIAL_ON): Promise<SocialProfile | null> {
  if (!on) return Promise.resolve(null);
  let p = cache.get(accountId);
  if (!p) {
    p = f(`${SOCIAL_API}/accounts/${encodeURIComponent(accountId)}`, { signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ has_profile?: boolean; name?: string | null; avatar_url?: string | null }>) : null))
      .then((j) => (j?.has_profile ? { accountId, name: j.name ?? null, avatarUrl: j.avatar_url ?? null, url: profileUrl(accountId) } : null))
      .catch(() => (cache.delete(accountId), null));
    cache.set(accountId, p);
  }
  return p;
}
