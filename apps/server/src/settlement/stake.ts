// The paid stake is the contract's config().entry_stake (USDC base units), not a constant: S4 can set
// it (e.g. 0.10 USDC for a cheap mainnet demo). The game plays the same at any stake; only the
// Micro to USDC conversion changes (core microPerBase). Read at boot, per paid join (60 s cache) and
// fresh at each paid 3-2-1, where every ticket must carry exactly that stake or the room aborts.
import { microPerBase } from "@margin/core";
import { log } from "../obs";
import type { Chain } from "./chain";

const TTL_MS = 60_000;
let cached: { base: number; at: number } | null = null;

/** Contract entry stake in USDC base units; `fresh` skips the 60 s cache. Throws on a stake core cannot settle. */
export async function paidStakeBase(chain: Chain, fresh = false, nowMs = Date.now()): Promise<number> {
  if (!fresh && cached && nowMs - cached.at < TTL_MS) return cached.base;
  const cfg = await chain.view<{ entry_stake: string }>("config");
  if (!cfg) throw new Error("contract config() unavailable");
  const base = Number(cfg.entry_stake);
  microPerBase(base); // throws "bad stake" if one entry is not a whole number of base units
  if (cached?.base !== base) log.info("paid_stake", { baseUnits: base, microPerBase: microPerBase(base) });
  cached = { base, at: nowMs };
  return base;
}

interface Ticket {
  stake: string;
  match_id: string | null;
}

/** Accounts whose live ticket does not carry exactly `base` (set_entry_stake changed mid-queue). */
export async function wrongStake(chain: Chain, accounts: string[], base: number): Promise<string[]> {
  const tickets = await Promise.all(accounts.map((a) => chain.view<Ticket | null>("ticket_of", { account_id: a })));
  return accounts.filter((_, i) => Number(tickets[i]?.stake ?? -1) !== base);
}
