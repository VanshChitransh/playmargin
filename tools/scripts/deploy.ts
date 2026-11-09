// Deploys the margin contract (and on testnet the mock USDC) for NETWORK. Idempotent: an
// account that already has code is left alone unless UPGRADE=1 (code-only redeploy, same state)
// or MIGRATE=1 (redeploy + migrate() in one tx, for a state layout change). Never deletes or
// recreates accounts. Build first: cargo near build non-reproducible-wasm --no-embed-abi.
// Sub-account deposits are lean on mainnet (they only pay gas): SETTLER_NEAR, RELAYER_NEAR.

import { readFileSync } from "node:fs";
import { ensureSubAccount } from "./keys.ts";
import { ENTRY_STAKE, IDS, NETWORK, guardMainnet, near, txLink } from "./net.ts";

const fund = (env: string | undefined, testnet: number, mainnet: number) =>
  `${Number(env ?? (NETWORK === "mainnet" ? mainnet : testnet))} NEAR` as const;

const root = new URL("../../contracts/", import.meta.url);
const wasm = (crate: string, file: string) => readFileSync(new URL(`${crate}/target/near/${file}.wasm`, root));

async function deployMockUsdc(): Promise<void> {
  await ensureSubAccount(IDS.usdc, "2 NEAR");
  if ((await near.getAccount(IDS.usdc)).hasContract) {
    if (process.env.UPGRADE !== "1") return;
    const r = await near.transaction(IDS.usdc).deployContract(IDS.usdc, wasm("mock-usdc", "mock_usdc")).send();
    console.log(`mock USDC upgraded: ${txLink(r)}`);
    return;
  }
  const r = await near
    .transaction(IDS.usdc)
    .deployContract(IDS.usdc, wasm("mock-usdc", "mock_usdc"))
    .functionCall(IDS.usdc, "new", { owner: IDS.contract })
    .send();
  console.log(`mock USDC deployed: ${txLink(r)}`);
}

async function deployMargin(): Promise<void> {
  const code = wasm("margin", "margin");
  const has = (await near.getAccount(IDS.contract)).hasContract;
  const migrate = process.env.MIGRATE === "1";
  if (has && process.env.UPGRADE !== "1" && !migrate) {
    console.log(`${IDS.contract} already has code (UPGRADE=1 to redeploy, MIGRATE=1 for a layout change)`);
    return;
  }
  let tx = near.transaction(IDS.contract).deployContract(IDS.contract, code);
  if (!has) {
    const args = { owner: IDS.owner, settler: IDS.settler, usdc: IDS.usdc, entry_stake: ENTRY_STAKE };
    tx = tx.functionCall(IDS.contract, "new", args);
  } else if (migrate) {
    tx = tx.functionCall(IDS.contract, "migrate", { entry_stake: ENTRY_STAKE });
  }
  const what = !has ? "deployed + initialised" : migrate ? "upgraded + migrated" : "upgraded";
  console.log(`margin ${what}: ${txLink(await tx.send())}`);
}

/** The contract must be registered on USDC to receive ft_transfer_call deposits. */
async function registerOnUsdc(): Promise<void> {
  const bal = await near.view(IDS.usdc, "storage_balance_of", { account_id: IDS.contract });
  if (bal) return;
  await near.call(
    IDS.usdc,
    "storage_deposit",
    { account_id: IDS.contract, registration_only: true },
    { signerId: IDS.contract, attachedDeposit: "0.00125 NEAR" },
  );
  console.log(`registered ${IDS.contract} on USDC`);
}

/** Moves ownership off the contract account (first testnet deploy was initialised that way). */
async function ensureOwner(): Promise<void> {
  const cfg = await near.view<{ owner: string }>(IDS.contract, "config", {});
  if (cfg?.owner === IDS.owner) return;
  if (NETWORK === "testnet") await ensureSubAccount(IDS.owner, "0.5 NEAR");
  await near.call(IDS.contract, "set_owner", { owner: IDS.owner }, { signerId: cfg?.owner ?? IDS.contract, attachedDeposit: "1 yocto" });
  console.log(`owner set to ${IDS.owner}`);
}

/** Applies ENTRY_STAKE if the live contract differs (owner, 1 yocto). */
async function ensureEntryStake(): Promise<void> {
  const cfg = await near.view<{ owner: string; entry_stake: string }>(IDS.contract, "config", {});
  if (!cfg || cfg.entry_stake === ENTRY_STAKE) return;
  await near.call(IDS.contract, "set_entry_stake", { entry_stake: ENTRY_STAKE }, { signerId: cfg.owner, attachedDeposit: "1 yocto" });
  console.log(`entry stake set to ${ENTRY_STAKE}`);
}

guardMainnet();
console.log(`network ${NETWORK}`, IDS);
if (NETWORK === "testnet") await deployMockUsdc();
await deployMargin();
await registerOnUsdc();
await ensureOwner();
await ensureEntryStake();
await ensureSubAccount(IDS.settler, fund(process.env.SETTLER_NEAR, 2, 0.1));
// The relayer pays players' gas for enter_arena (services/relayer); its own account avoids
// nonce clashes with the settler (EDGE-CASES NS-24).
await ensureSubAccount(IDS.relayer, fund(process.env.RELAYER_NEAR, 1, 0.15));
console.log("config", await near.view(IDS.contract, "config", {}));
