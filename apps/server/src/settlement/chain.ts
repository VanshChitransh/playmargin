// The server's link to the margin contract, signing as the settler. Config is env only:
// NETWORK, CONTRACT_ID, SETTLER_ID, SETTLER_PRIVATE_KEY, RPC_URLS (comma list, first = keyed).
// Network errors move to the next RPC with backoff; contract panics are final and never retried.
import { FunctionCallError, Near, type PrivateKey } from "near-kit";

export type Network = "testnet" | "mainnet";

export interface ChainConfig {
  network: Network;
  contractId: string;
  settlerId: string;
  privateKey: string;
  rpcUrls: string[];
}

/** Read chain config from env; null when paid mode is not configured on this box. */
export function chainConfigFromEnv(env = process.env): ChainConfig | null {
  const network: Network = env.NETWORK === "mainnet" ? "mainnet" : "testnet";
  const { CONTRACT_ID, SETTLER_ID, SETTLER_PRIVATE_KEY } = env;
  if (!CONTRACT_ID || !SETTLER_ID || !SETTLER_PRIVATE_KEY) return null;
  const fallback = network === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com";
  const rpcUrls = (env.RPC_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  return { network, contractId: CONTRACT_ID, settlerId: SETTLER_ID, privateKey: SETTLER_PRIVATE_KEY, rpcUrls: [...rpcUrls, fallback] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRIES = 4;

export class Chain {
  private readonly clients: Near[];

  constructor(readonly cfg: ChainConfig) {
    this.clients = cfg.rpcUrls.map(
      (rpcUrl) =>
        new Near({
          network: { rpcUrl, networkId: cfg.network },
          privateKey: cfg.privateKey as PrivateKey,
          defaultSignerId: cfg.settlerId,
          retryConfig: { maxRetries: 1 },
        }),
    );
  }

  /** Run fn on each RPC in turn with 1 s, 2 s, 4 s backoff; a contract panic is thrown at once. */
  private async withFallback<T>(fn: (near: Near) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i < TRIES; i++) {
      try {
        return await fn(this.clients[i % this.clients.length]!);
      } catch (err) {
        if (err instanceof FunctionCallError) throw err;
        last = err;
        await sleep(1000 * 2 ** i);
      }
    }
    throw last;
  }

  /** View call on the margin contract. */
  view<T>(method: string, args: object = {}): Promise<T | undefined> {
    return this.withFallback((near) => near.view<T>(this.cfg.contractId, method, args));
  }

  /** Access key permission for (account, key), or null when the key is not on the account. */
  accessKey(accountId: string, publicKey: string) {
    return this.withFallback((near) => near.getAccessKey(accountId, publicKey));
  }

  /** Settler call on the margin contract; returns the tx hash. */
  async call(method: string, args: object): Promise<string> {
    const out = await this.withFallback((near) =>
      near.call(this.cfg.contractId, method, args, { gas: "100 Tgas", waitUntil: "FINAL" }),
    );
    return (out as { transaction: { hash: string } }).transaction.hash;
  }
}
