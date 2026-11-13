// The server's link to the margin contract, signing as the settler. Config is env only:
// NETWORK, CONTRACT_ID, SETTLER_ID, SETTLER_PRIVATE_KEY, RPC_URLS (comma list, first = keyed).
// Network errors move to the next RPC with backoff; contract panics are final and never retried.
import { FunctionCallError, Near, type PrivateKey } from "near-kit";
// Shared with the browser chain code and the relayer: one RPC list, one access key reader.
import { accessKey as readAccessKey, rpcUrls } from "../../../client/src/chain/rpc";

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
  // RPC_URLS first (a keyed provider), then FastNEAR, then NEAR's own RPC: two free fallbacks.
  return { network, contractId: CONTRACT_ID, settlerId: SETTLER_ID, privateKey: SETTLER_PRIVATE_KEY, rpcUrls: rpcUrls(network, env.RPC_URLS ?? "") };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRIES = 4;

export class Chain {
  private readonly clients: Near[];

  /** backoffMs: first wait between RPC attempts, doubling each time (tests pass 0, no network waits). */
  constructor(
    readonly cfg: ChainConfig,
    private readonly backoffMs = 1000,
  ) {
    this.clients = cfg.rpcUrls.map(
      (rpcUrl) =>
        new Near({
          network: { rpcUrl, networkId: cfg.network },
          privateKey: cfg.privateKey as PrivateKey,
          defaultSignerId: cfg.settlerId,
          retryConfig: { maxRetries: 1, initialDelayMs: backoffMs },
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
        if (i < TRIES - 1) await sleep(this.backoffMs * 2 ** i); // no wait after the last try: just throw
      }
    }
    throw last;
  }

  /** View call on the margin contract. */
  view<T>(method: string, args: object = {}): Promise<T | undefined> {
    return this.withFallback((near) => near.view<T>(this.cfg.contractId, method, args));
  }

  /**
   * Access key permission for (account, key), or null when the key is not on the account. near-kit's
   * getAccessKey returns null on ANY error, so a dead RPC read as "unknown key" and never reached the
   * fallback (QA-D-07): readAccessKey rethrows network errors so withFallback moves on.
   */
  accessKey(accountId: string, publicKey: string) {
    return this.withFallback((near) => readAccessKey(near, accountId, publicKey));
  }

  /** Spendable NEAR of the settler account (near-kit: balance minus storage stake). */
  async settlerNear(): Promise<number> {
    return Number(await this.withFallback((near) => near.getBalance(this.cfg.settlerId)));
  }

  /** Settler call on the margin contract; returns the tx hash. */
  async call(method: string, args: object): Promise<string> {
    const out = await this.withFallback((near) =>
      near.call(this.cfg.contractId, method, args, { gas: "100 Tgas", waitUntil: "FINAL" }),
    );
    return (out as { transaction: { hash: string } }).transaction.hash;
  }
}
