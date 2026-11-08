// Network switch for every chain script: NETWORK=testnet|mainnet picks all account ids.
// Keys come from ~/.near-credentials/<network> (near-cli layout), never from the repo.

import { homedir } from "node:os";
import { join } from "node:path";
import { Near } from "near-kit";
import { FileKeyStore } from "near-kit/keys/file";

export type Network = "testnet" | "mainnet";

export const NETWORK: Network = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";

/** Account ids per network. Mainnet USDC is Circle's native NEP-141 token. */
export const IDS = {
  testnet: {
    contract: "playmargin.testnet",
    owner: "owner.playmargin.testnet",
    settler: "settler.playmargin.testnet",
    usdc: "usdc.playmargin.testnet",
    player: "player1.playmargin.testnet",
  },
  mainnet: {
    contract: "playmargin.near",
    // Vansh's personal account (payout wallet). Confirm with Vansh at N9 before mainnet.
    owner: "vanshverse.near",
    settler: "settler.playmargin.near",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    player: "",
  },
}[NETWORK];

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
