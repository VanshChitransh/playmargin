// Two RPC providers per network, so one outage (FastNEAR testnet was reported down on 9 Nov) does
// not stop balances, quick play or the relayer. Same idea as the server's settlement/chain.ts.
// Shared by the browser chain code and services/relayer, so it reads no env itself.
import { Near, NetworkError, type NearConfig } from "near-kit";

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
