// A7: one named NEAR account per liquidator drone, so each drone's bounties are a public on-chain
// P&L. Idempotent: an existing account is left alone (never delete and recreate, a squatter can
// take the name). With --register, the owner also registers them as agents (set_agents, 1 yocto)
// so settle may pay them their bounties; needs the contract with set_agents (UPGRADE=1 deploy).
// Run from tools/scripts: NETWORK=testnet ../../node_modules/.bin/tsx drones.ts [--register]
import { ensureSubAccount } from "./keys.ts";
import { IDS, guardMainnet, near } from "./net.ts";

/** Paid rooms use up to 3 drones (RULES DRONES_PER_ROOM), drone-1 .. drone-3. */
export const droneAccount = (n: number): string => `drone-${n}.${IDS.contract}`;
const drones = [1, 2, 3].map(droneAccount);
guardMainnet(); // mainnet needs CONFIRM_MAINNET=yes

for (const d of drones) await ensureSubAccount(d, "0.05 NEAR");
console.log(`drones: ${drones.join(", ")}`);

if (process.argv.includes("--register")) {
  const missing = [];
  for (const d of drones) if (!(await near.view<boolean>(IDS.contract, "is_agent", { account_id: d }))) missing.push(d);
  if (missing.length > 0) {
    await near.call(IDS.contract, "set_agents", { add: missing, remove: [] }, { signerId: IDS.owner, attachedDeposit: "1 yocto", waitUntil: "FINAL" });
  }
  console.log(`registered as agents: ${drones.join(", ")}${missing.length ? "" : " (already)"}`);
}
