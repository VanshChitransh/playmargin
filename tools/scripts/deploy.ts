// Deploys the margin contract (and on testnet the mock USDC) for NETWORK. Idempotent: an
// account that already has code is left alone unless UPGRADE=1 (code-only redeploy, same state)
// or MIGRATE=1 (redeploy + migrate() in one tx, for a state layout change). Never deletes or
// recreates accounts. Build first: cargo near build non-reproducible-wasm --no-embed-abi.
// Sub-account deposits are lean on mainnet (they only pay gas): SETTLER_NEAR, RELAYER_NEAR. The
// settler needs > 0.101 NEAR free at all times: NEAR reserves 100 Tgas at 10x the gas price.

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
  if ((!has || migrate) && !ENTRY_STAKE) throw new Error("set ENTRY_STAKE (100000 = 0.10 USDC, 1000000 = 1 USDC) for a first deploy or MIGRATE=1");
  let tx = near.transaction(IDS.contract).deployContract(IDS.contract, code);
  if (!has) {
    const args = { owner: IDS.owner, settler: IDS.settler, usdc: IDS.usdc, entry_stake: ENTRY_STAKE };
    tx = tx.functionCall(IDS.contract, "new", args);
  } else if (migrate) {
    tx = tx.functionCall(IDS.contract, "migrate", { entry_stake: ENTRY_STAKE });
  }
  const what = !has ? "deployed + initialised" : migrate ? "upgraded + migrated" : "upgraded";
  console.log(`margin ${what}: ${txLink(await tx.send({ waitUntil: "FINAL" }))}`);
}

/** Registers `account` on USDC (the contract to receive deposits, the owner to hold the vault seed). */
async function registerOnUsdc(account: string): Promise<void> {
  const bal = await near.view(IDS.usdc, "storage_balance_of", { account_id: account });
  if (bal) return;
  await near.call(
    IDS.usdc,
    "storage_deposit",
    { account_id: account, registration_only: true },
    { signerId: IDS.contract, attachedDeposit: "0.00125 NEAR" },
  );
  console.log(`registered ${account} on USDC`);
}

/** Our owner sub-account (default owner.<contract>), key made here: no seed phrase on a command line. */
const ownOwner = IDS.owner.endsWith(`.${IDS.contract}`);

/** Moves ownership off the contract account (first testnet deploy was initialised that way). */
async function ensureOwner(): Promise<void> {
  const cfg = await near.view<{ owner: string }>(IDS.contract, "config", {});
  if (cfg?.owner === IDS.owner) return;
  await near.call(IDS.contract, "set_owner", { owner: IDS.owner }, { signerId: cfg?.owner ?? IDS.contract, attachedDeposit: "1 yocto", waitUntil: "FINAL" });
  console.log(`owner set to ${IDS.owner}`);
}

/** Applies ENTRY_STAKE if it is set and the live contract differs (owner, 1 yocto). Unset = keep the live stake. */
async function ensureEntryStake(): Promise<void> {
  if (!ENTRY_STAKE) return;
  const cfg = await near.view<{ owner: string; entry_stake: string }>(IDS.contract, "config", {});
  if (!cfg || cfg.entry_stake === ENTRY_STAKE) return;
  await near.call(IDS.contract, "set_entry_stake", { entry_stake: ENTRY_STAKE }, { signerId: cfg.owner, attachedDeposit: "1 yocto", waitUntil: "FINAL" });
  console.log(`entry stake set to ${ENTRY_STAKE}`);
}

guardMainnet();
console.log(`network ${NETWORK}`, IDS);
if (NETWORK === "testnet") await deployMockUsdc();
await deployMargin();
await registerOnUsdc(IDS.contract);
if (ownOwner) {
  await ensureSubAccount(IDS.owner, fund(process.env.OWNER_NEAR, 0.5, 0.05));
  await registerOnUsdc(IDS.owner);
}
await ensureOwner();
await ensureEntryStake();
await ensureSubAccount(IDS.settler, fund(process.env.SETTLER_NEAR, 2, 0.25));
// The relayer pays players' gas for enter_arena (services/relayer); its own account avoids
// nonce clashes with the settler (EDGE-CASES NS-24).
await ensureSubAccount(IDS.relayer, fund(process.env.RELAYER_NEAR, 1, 0.15));
console.log("config", await near.view(IDS.contract, "config", {}));
