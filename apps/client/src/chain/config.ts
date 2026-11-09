// Chain settings for the browser. VITE_NETWORK=testnet|mainnet switches every account id,
// mirroring tools/scripts/net.ts so the client and the scripts never disagree.

export type Network = "testnet" | "mainnet";

// Under tsx (tools/scripts) import.meta.env is absent: fall back to process.env so a script can
// point the shipped client code at another contract (VITE_CONTRACT_ID, VITE_RELAYER_URL).
const proc = (globalThis as { process?: { env: Partial<ImportMetaEnv> } }).process;
const env: Partial<ImportMetaEnv> = import.meta.env ?? proc?.env ?? {};

export const NETWORK: Network = env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";

const IDS = {
  testnet: { contract: "playmargin.testnet", usdc: "usdc.playmargin.testnet" },
  mainnet: {
    contract: "playmargin.near",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  },
}[NETWORK];

/** VITE_CONTRACT_ID overrides it (mainnet: playmargin.near or margin.vanshverse.near). */
export const CONTRACT_ID = env.VITE_CONTRACT_ID ?? IDS.contract;
export const USDC_ID = IDS.usdc;

/** NEP-366 relayer (services/relayer). */
export const RELAYER_URL: string =
  env.VITE_RELAYER_URL ?? (typeof location === "undefined" ? "http://localhost:3030" : `${location.protocol}//${location.hostname}:3030`);

export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
