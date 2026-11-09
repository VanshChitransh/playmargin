// TypeScript mirror of the margin contract's JSON args. u128 values travel as decimal
// strings (near-sdk U128) because JS numbers lose precision past 2^53.

/** USDC base units (6 decimals) as a decimal string. */
export type U128 = string;

/** enter_arena: creates at most one live ticket per account (EDGE-CASES NS-10). */
export interface EnterArgs {
  stake: U128;
}

/** open_match (settler, at GO): assigns these players' tickets and reserves budget = 1.5 x stakes. */
export interface OpenMatchArgs {
  match_id: string;
  players: string[];
}

/**
 * settle (settler only), = contracts/margin/src/arena.rs settle. The contract asserts
 * sum(payouts) + vault_repaid + interest_to_vault + fees + reserve == stakes + lent,
 * lent <= budget reserved at open, vault_repaid <= lent. Build it with toSettleArgs, never by hand.
 */
export interface SettleArgs {
  match_id: string;
  /** [account_id, amount] pairs. */
  payouts: Array<[string, U128]>;
  /** Principal the vault lent in this match. */
  lent: U128;
  /** Principal repaid; lent - vault_repaid is bad debt, covered by the contract reserve. */
  vault_repaid: U128;
  interest_to_vault: U128;
  /** Vault share of borrow fees (the rest is inside reserve). */
  fees: U128;
  /** Reserve share plus Micro-to-USDC rounding dust. */
  reserve: U128;
  seq: number;
  head: string;
}

/** reclaim (player, 15 min after an unsettled match): no args. */
export type ReclaimArgs = Record<string, never>;

/** refund_ticket (settler): an unassigned or no-show ticket. */
export interface RefundTicketArgs {
  account_id: string;
}

export interface AnchorArgs {
  room_id: string;
  seq: number;
  head: string;
}
