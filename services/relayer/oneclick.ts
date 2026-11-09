// 1-Click (NEAR Intents) proxy for Add funds. The partner JWT stays here, never in the browser.
// Every quote lands as native USDC on NEAR at our contract with {"for": player} as the
// ft_transfer_call msg, has a minimum-out (1% slippage), and is dry unless ONECLICK_LIVE=1
// (live deposits need playmargin.near to exist on mainnet, task N9).

const BASE = "https://1click.chaindefuser.com/v0";
const UA = "playmargin/0.1 (+https://playmargin.fun)";
export const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ORIGIN_SYMBOLS = new Set(["USDC", "USDT", "ETH", "SOL", "NEAR", "BTC"]);

export interface Token {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  price: number;
}

export interface QuoteInput {
  accountId: string;
  originAsset: string;
  /** Origin token base units, decimal string. */
  amount: string;
  /** Address on the origin chain that gets a refund if the swap fails. */
  refundTo: string;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "user-agent": UA, "content-type": "application/json" };
  if (process.env.ONECLICK_JWT) h.authorization = `Bearer ${process.env.ONECLICK_JWT}`;
  return h;
}

let tokenCache: { at: number; list: Token[] } | null = null;

/** Origin tokens we offer, cached 10 min (prices are informational; the quote is the truth). */
export async function tokens(): Promise<Token[]> {
  if (tokenCache && Date.now() - tokenCache.at < 600_000) return tokenCache.list;
  const r = await fetch(`${BASE}/tokens`, { headers: headers() });
  if (!r.ok) throw new Error(`tokens ${r.status}`);
  const list = ((await r.json()) as Token[]).filter((t) => ORIGIN_SYMBOLS.has(t.symbol) && t.assetId !== USDC_NEAR);
  tokenCache = { at: Date.now(), list };
  return list;
}

const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Returns why the input is refused, or null. Pure: unit-tested. */
export function quoteInputError(q: Partial<QuoteInput>, known: (assetId: string) => boolean): string | null {
  if (typeof q.accountId !== "string" || !ACCOUNT.test(q.accountId)) return "bad account";
  if (typeof q.originAsset !== "string" || !known(q.originAsset)) return "unsupported token";
  if (typeof q.amount !== "string" || !/^[1-9]\d{0,38}$/.test(q.amount)) return "bad amount";
  if (typeof q.refundTo !== "string" || q.refundTo.length < 4 || q.refundTo.length > 128) return "bad refund address";
  return null;
}

/** Builds the 1-Click QuoteRequest. Pure: unit-tested. */
export function quoteRequest(q: QuoteInput, recipient: string, live: boolean, now: number): object {
  return {
    dry: !live,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: q.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC_NEAR,
    amount: q.amount,
    refundTo: q.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    customRecipientMsg: JSON.stringify({ for: q.accountId }),
    deadline: new Date(now + 30 * 60_000).toISOString(),
    referral: "playmargin",
  };
}

/** Proxies a quote. Returns the upstream status + body so the client can show "no quote right now". */
export async function quote(q: QuoteInput): Promise<{ status: number; body: unknown }> {
  const recipient = process.env.ONECLICK_RECIPIENT ?? "playmargin.near";
  const body = quoteRequest(q, recipient, process.env.ONECLICK_LIVE === "1", Date.now());
  const r = await fetch(`${BASE}/quote`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** Execution status of a live deposit address. */
export async function status(depositAddress: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${BASE}/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers: headers() });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
