// A7: one named NEAR account per liquidator drone, so each drone's bounties are a public on-chain
// P&L. Idempotent: an existing account is left alone (never delete and recreate, a squatter can
// take the name). Run: NETWORK=testnet ../../node_modules/.bin/tsx drones.ts (from tools/scripts).
import { ensureSubAccount } from "./keys.ts";
import { IDS } from "./net.ts";

/** Paid rooms use up to 3 drones (RULES DRONES_PER_ROOM), drone-1 .. drone-3. */
export const droneAccount = (n: number): string => `drone-${n}.${IDS.contract}`;

for (let n = 1; n <= 3; n++) await ensureSubAccount(droneAccount(n), "0.05 NEAR");
console.log(`drones: ${[1, 2, 3].map(droneAccount).join(", ")}`);
