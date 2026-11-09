// Which Settlement adapter a room gets. Free and paid rooms share all room code (Port/Adapter).
import type { Mode, Settlement } from "@margin/core";
import type { Db } from "../db";
import { CreditsSettlement } from "./credits";

/** users: blob id to credits user id, filled by the room as humans join. */
export function settlementFor(mode: Mode, db: Db, users: ReadonlyMap<string, string>): Settlement {
  if (mode === "free") return new CreditsSettlement(db, users);
  return {
    open: async () => {},
    // Paid payouts must go on chain; until NearSettlement (S6) lands they are refused, never faked.
    settle: async () => {
      throw new Error("paid settlement not wired yet (S6)");
    },
  };
}
