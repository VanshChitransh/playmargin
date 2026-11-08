// TypeScript mirror of the margin contract's JSON args. u128 values travel as decimal
// strings (near-sdk U128) because JS numbers lose precision past 2^53.

/** USDC base units (6 decimals) as a decimal string. */
export type U128 = string;

/** enter_arena: creates at most one live ticket per account (EDGE-CASES NS-10). */
export interface EnterArgs {
  stake: U128;
}

export interface SettleArgs {
  match_id: string;
  /** [account_id, amount] pairs. */
  payouts: Array<[string, U128]>;
  vault_repaid: U128;
  interest_to_vault: U128;
  reserve: U128;
  seq: number;
  head: string;
}

export interface AnchorArgs {
  room_id: string;
  seq: number;
  head: string;
}
