// Network switch for every chain script: NETWORK=testnet|mainnet picks all account ids.
// Mainnet ids are config, decided on launch day (MAINNET-RUNBOOK.md): CONTRACT_ID, OWNER_ID,
// SETTLER_ID, RELAYER_ID, ENTRY_STAKE. Keys come from ~/.near-credentials/<network>, never the repo.

import { homedir } from "node:os";
import { join } from "node:path";
import { Near } from "near-kit";
import { FileKeyStore } from "near-kit/keys/file";

export type Network = "testnet" | "mainnet";

/** playmargin.near (top-level name) or margin.vanshverse.near (sub-account, no new name). */
const MAINNET_CONTRACT = process.env.CONTRACT_ID ?? "playmargin.near";

export const NETWORK: Network = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";

/** Account ids per network. Mainnet USDC is Circle's native NEP-141 token. */
export const IDS = {
  testnet: {
    contract: "playmargin.testnet",
    owner: "owner.playmargin.testnet",
    settler: "settler.playmargin.testnet",
    relayer: "relayer.playmargin.testnet",
    usdc: "usdc.playmargin.testnet",
    // Own test player: other lanes test with player1, and shared tickets collide.
    player: process.env.PLAYER_ID ?? "e2e.playmargin.testnet",
  },
  mainnet: {
    contract: MAINNET_CONTRACT,
    // Vansh's personal account (payout wallet), never the contract account itself.
    owner: process.env.OWNER_ID ?? "vanshverse.near",
    settler: process.env.SETTLER_ID ?? `settler.${MAINNET_CONTRACT}`,
    relayer: process.env.RELAYER_ID ?? `relayer.${MAINNET_CONTRACT}`,
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    player: "",
  },
}[NETWORK];

/** Paid entry in USDC base units (1 USDC = 1000000). 0.10 USDC = 100000 for a lean launch. */
export const ENTRY_STAKE = process.env.ENTRY_STAKE ?? "1000000";

export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

export const keyStore = new FileKeyStore(join(homedir(), ".near-credentials"), NETWORK);

export const near = new Near({ network: NETWORK, keyStore });

/** Every mainnet transaction needs Vansh's explicit go-ahead (DEVELOPMENT.md N9). */
export function guardMainnet(): void {
  if (NETWORK === "mainnet" && process.env.CONFIRM_MAINNET !== "yes") {
    throw new Error("mainnet: set CONFIRM_MAINNET=yes only after Vansh approves this run");
  }
}

/** Explorer link for a tx outcome. */
export function txLink(outcome: { transaction: { hash: string } }): string {
  return `${EXPLORER}/txns/${outcome.transaction.hash}`;
}
