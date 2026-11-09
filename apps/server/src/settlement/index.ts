// Which Settlement adapter a room gets. Free and paid rooms share all room code (Port/Adapter).
import type { Mode, Settlement } from "@margin/core";
import type { Db } from "../db";
import { Chain, chainConfigFromEnv } from "./chain";
import { CreditsSettlement } from "./credits";
import { NearSettlement } from "./near";

let chain: Chain | null | undefined;

/** The settler's chain link, or null when this box has no settler key (paid mode off). */
export function sharedChain(): Chain | null {
  if (chain === undefined) {
    const cfg = chainConfigFromEnv();
    chain = cfg ? new Chain(cfg) : null;
  }
  return chain;
}

/** users: blob id to credits user id, filled by the room as humans join (free rooms). */
export function settlementFor(mode: Mode, db: Db, users: ReadonlyMap<string, string>): Settlement {
  if (mode === "free") return new CreditsSettlement(db, users);
  const c = sharedChain();
  if (!c) throw new Error("paid mode is off on this server (no settler key)");
  return new NearSettlement(c);
}
