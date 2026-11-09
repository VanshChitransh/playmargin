// Settlement adapter for paid rooms: open_match binds tickets and reserves the vault budget,
// settle pays out on chain with the log head. Idempotent by match id: before each attempt it
// reads the match on chain, so a retry after a lost RPC answer never double-settles.
import type { MatchOpen, SettleResult, Settlement, TxRef } from "@margin/core";
import type { Chain } from "./chain";
import { toSettleArgs } from "./toSettleArgs";

interface OnchainMatch {
  status: "Open" | "Settled" | "Cancelled";
  head: string;
}

export class NearSettlement implements Settlement {
  constructor(private readonly chain: Chain) {}

  async open(match: MatchOpen): Promise<void> {
    if (await this.chain.view<OnchainMatch>("match_of", { match_id: match.matchId })) return;
    const players = match.players.map((p) => p.accountId).filter((a): a is string => !!a);
    try {
      await this.chain.call("open_match", { match_id: match.matchId, players });
    } catch (err) {
      // A retry after a lost reply fails with "already used": the first attempt landed.
      if (!(await this.chain.view<OnchainMatch>("match_of", { match_id: match.matchId }))) throw err;
    }
  }

  async settle(result: SettleResult, head: string): Promise<TxRef> {
    const network = this.chain.cfg.network;
    const onchain = await this.chain.view<OnchainMatch>("match_of", { match_id: result.matchId });
    if (onchain?.status === "Settled") {
      if (onchain.head !== head) throw new Error(`${result.matchId} already settled with another head`);
      return { network, hash: "" };
    }
    try {
      return { network, hash: await this.chain.call("settle", toSettleArgs(result)) };
    } catch (err) {
      const after = await this.chain.view<OnchainMatch>("match_of", { match_id: result.matchId });
      if (after?.status === "Settled" && after.head === head) return { network, hash: "" };
      throw err;
    }
  }
}
