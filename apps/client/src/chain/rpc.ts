// Two RPC providers per network, so one outage (FastNEAR testnet was reported down on 9 Nov) does
// not stop balances, quick play or the relayer. Same idea as the server's settlement/chain.ts.
// Shared by the browser chain code and services/relayer, so it reads no env itself.
import { Near, NetworkError, type NearConfig } from "near-kit";

/** Re-exported so callers with their own near-kit copy throw the class withFallback checks for. */
export { NetworkError };

type Network = "testnet" | "mainnet";

const DEFAULTS: Record<Network, string[]> = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"],
};

/** RPC order: `extra` (comma list from env, e.g. a keyed provider) first, then FastNEAR, then NEAR's own. */
export function rpcUrls(network: Network, extra = ""): string[] {
  const mine = extra.split(",").map((u) => u.trim()).filter(Boolean);
  return [...new Set([...mine, ...DEFAULTS[network]])];
}

/** One near-kit client per RPC, same options. Few retries each: the next provider is the retry. */
export function nearClients(network: Network, extra = "", opts: Omit<NearConfig, "network"> = {}): Near[] {
  return rpcUrls(network, extra).map(
    (rpcUrl) => new Near({ ...opts, network: { rpcUrl, networkId: network }, retryConfig: { maxRetries: 1 } }),
  );
}

/**
 * The access key, or null when it is not on the account. near-kit's own getAccessKey returns null
 * on ANY error, so an unreachable RPC looked like "unknown key" and never reached the next one.
 */
export async function accessKey(near: Near, accountId: string, publicKey: string) {
  try {
    return await near.rpc.getAccessKey(accountId, publicKey);
  } catch (err) {
    if (err instanceof NetworkError) throw err;
    return null;
  }
}

/**
 * Run fn on each client in turn. Only a NetworkError (the RPC could not be reached) moves on:
 * a contract panic, an invalid tx or a timeout after sending is final, so a tx is never sent twice.
 */
export async function withFallback<T>(clients: Near[], fn: (near: Near) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const near of clients) {
    try {
      return await fn(near);
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
      last = err;
    }
  }
  throw last;
}

/** withFallback over this network's RPCs, also reporting which RPC answered (the Verify page shows it). */
async function answered<T>(network: Network, fn: (near: Near) => Promise<T>): Promise<{ value: T; rpc: string }> {
  const urls = rpcUrls(network);
  const clients = nearClients(network);
  let rpc = "";
  const value = await withFallback(clients, (near) => {
    rpc = urls[clients.indexOf(near)]!;
    return fn(near);
  });
  return { value, rpc };
}

/** A view call read straight from NEAR (no keys), e.g. anchor_of or match_of on the margin contract. */
export function viewOnChain<T>(network: Network, contractId: string, method: string, args: object = {}): Promise<{ value: T; rpc: string }> {
  return answered(network, async (near) => (await near.view<T>(contractId, method, args)) as T);
}

export type TxView = {
  transaction: { actions: Array<string | { FunctionCall?: { method_name: string; args: string } }> };
  transaction_outcome: { block_hash: string };
  receipts_outcome: Array<{ outcome: { status: unknown } }>;
};

/**
 * The first FunctionCall of a tx, args decoded, read from NEAR. An older free match is checked
 * against ITS hour's anchor tx (anchor_of keeps only the latest hour), a paid match against its settle.
 * "failed" when any receipt failed, so a reverted settle never verifies. Raw "tx" RPC, because
 * near-kit's getTransactionStatus throws on a failed tx instead of returning it.
 */
export async function txFunctionCall(network: Network, txHash: string, signerId: string) {
  const { value: tx, rpc } = await answered(network, async (near) => near.rpc.call<TxView>("tx", { tx_hash: txHash, sender_account_id: signerId, wait_until: "FINAL" }));
  const { value: block } = await answered(network, (near) => near.rpc.getBlock({ blockId: tx.transaction_outcome.block_hash }));
  return { ...firstCall(tx), block: Number(block.header.height), rpc };
}

/** Method, decoded JSON args and ok/failed of a tx's first FunctionCall (pure, for tests). */
export function firstCall(tx: TxView): { method: string; args: unknown; status: "ok" | "failed" } {
  const fc = tx.transaction.actions.map((a) => (typeof a === "object" ? a.FunctionCall : undefined)).find(Boolean);
  if (!fc) throw new Error("not a function call transaction");
  const args: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(fc.args), (c) => c.charCodeAt(0))));
  const failed = tx.receipts_outcome.some((r) => JSON.stringify(r.outcome.status).includes("Failure"));
  return { method: fc.method_name, args, status: failed ? "failed" : "ok" };
}
