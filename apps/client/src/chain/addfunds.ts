// Add funds from any chain via 1-Click (NEAR Intents), through our relayer's proxy so the partner
// key never ships to the browser. Flow: pick token -> quote (shows min-out) -> deposit address
// + QR (live only) -> poll status. "No quote right now" is a normal state, not an error.

import { RELAYER_URL } from "./config";

export interface OriginToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  price: number;
}

export interface Quote {
  amountInFormatted: string;
  amountOutFormatted: string;
  /** USDC base units the player is guaranteed at least (1% slippage). */
  minAmountOut: string;
  timeEstimate: number;
  /** Present only on live quotes: where the player sends funds. */
  depositAddress?: string;
}

export type QuoteResult = { ok: true; quote: Quote; dry: boolean } | { ok: false; reason: string };

export async function originTokens(relayer = RELAYER_URL): Promise<OriginToken[]> {
  const r = await fetch(`${relayer}/tokens`);
  if (!r.ok) throw new Error("Intents unavailable right now");
  return (await r.json()) as OriginToken[];
}

/** Quotes `amount` (origin base units) of `originAsset` into the player's MARGIN balance. */
export async function quoteDeposit(
  accountId: string,
  originAsset: string,
  amount: string,
  refundTo: string,
  relayer = RELAYER_URL,
): Promise<QuoteResult> {
  const r = await fetch(`${relayer}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, originAsset, amount, refundTo }),
  });
  const body = (await r.json().catch(() => ({}))) as { quote?: Quote; quoteRequest?: { dry?: boolean }; error?: string; message?: string };
  if (!r.ok || !body.quote) return { ok: false, reason: body.error ?? body.message ?? "No quote right now, try again in a minute" };
  return { ok: true, quote: body.quote, dry: body.quoteRequest?.dry !== false };
}

export type DepositState = "waiting" | "processing" | "done" | "refunded" | "failed";

/** 1-Click execution status -> the five states the UI shows. Pure: unit-tested. */
export function depositState(status: string): DepositState {
  switch (status) {
    case "SUCCESS":
      return "done";
    case "REFUNDED":
      return "refunded";
    case "FAILED":
      return "failed";
    case "PROCESSING":
    case "KNOWN_DEPOSIT_TX":
      return "processing";
    default:
      return "waiting"; // PENDING_DEPOSIT, INCOMPLETE_DEPOSIT, unknown
  }
}

export const STATE_WORDS: Record<DepositState, string> = {
  waiting: "Waiting for your deposit",
  processing: "Deposit seen, swapping to USDC",
  done: "Funds added",
  refunded: "Refunded to your address",
  failed: "Swap failed, funds return to your refund address",
};

/** Polls a live deposit address once. */
export async function depositStatus(depositAddress: string, relayer = RELAYER_URL): Promise<DepositState> {
  const r = await fetch(`${relayer}/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  if (!r.ok) return "waiting";
  return depositState(((await r.json()) as { status?: string }).status ?? "");
}
