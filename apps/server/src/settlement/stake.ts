// The paid stake is the contract's config().entry_stake (USDC base units), not a constant: S4 can
// set it (e.g. 0.10 USDC for a cheap mainnet demo). Read at boot and refreshed per paid match.
// ponytail: until core takes the stake as a parameter (S1), a stake that differs from core's
// entryFor("paid") refuses paid joins up front instead of failing at settle.
import { entryFor } from "@margin/core";
import { log } from "../obs";
import type { Chain } from "./chain";
import { MICRO_PER_BASE } from "./toSettleArgs";

const TTL_MS = 60_000;
let cached: { micro: number; at: number } | null = null;

/** Contract entry stake in Micro (cached 60 s). */
export async function paidStakeMicro(chain: Chain, nowMs = Date.now()): Promise<number> {
  if (cached && nowMs - cached.at < TTL_MS) return cached.micro;
  const cfg = await chain.view<{ entry_stake: string }>("config");
  if (!cfg) throw new Error("contract config() unavailable");
  const micro = Number(cfg.entry_stake) * MICRO_PER_BASE;
  if (!cached || cached.micro !== micro) log.info("paid_stake", { baseUnits: cfg.entry_stake, micro, coreMicro: entryFor("paid") });
  cached = { micro, at: nowMs };
  return micro;
}

/** Throws (paid join refused) while the contract stake and the engine's paid entry disagree. */
export async function assertStakeMatches(chain: Chain): Promise<void> {
  const micro = await paidStakeMicro(chain);
  if (micro !== entryFor("paid")) {
    log.error("paid_stake_mismatch", { contractMicro: micro, coreMicro: entryFor("paid") });
    throw new Error("paid rooms are paused: stake mismatch between the contract and the game server");
  }
}
