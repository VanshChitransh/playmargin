// Chain settings for the browser. VITE_NETWORK=testnet|mainnet switches every account id,
// mirroring tools/scripts/net.ts so the client and the scripts never disagree.

export type Network = "testnet" | "mainnet";

// Optional chaining lets tools/scripts run these modules under tsx, where import.meta.env is absent.
const env: Partial<ImportMetaEnv> = import.meta.env ?? {};

export const NETWORK: Network = env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";

const IDS = {
  testnet: { contract: "playmargin.testnet", usdc: "usdc.playmargin.testnet" },
  mainnet: {
    contract: "playmargin.near",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  },
}[NETWORK];

export const CONTRACT_ID = IDS.contract;
export const USDC_ID = IDS.usdc;

/** NEP-366 relayer (services/relayer). */
export const RELAYER_URL: string =
  env.VITE_RELAYER_URL ?? (typeof location === "undefined" ? "http://localhost:3030" : `${location.protocol}//${location.hostname}:3030`);

/** 1 USDC in base units: the only paid entry (RULES ENTRY_PAID_USDC). */
export const ENTRY_STAKE = "1000000";

export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
