// One call behind the PLAY $1 button: make sure quick play is on, hold exactly one live ticket,
// and hand back a join signer. Colyseus reads join options before it picks a room, so the proof
// names the "paid" scope, not a room id: the server's one-use 60 s nonce stops replays. The client
// joins the queue only after this resolves, so the 8 s window counts only funded players (NS-10).

import { ENTRY_STAKE } from "./config";
import { balanceOf, ticketOf } from "./funds";
import { signJoin, type SignedJoin } from "./join";
import { enableQuickPlay, enterArena, sessionKey } from "./session";

export type PaidStep = "quick-play" | "ticket" | "ready";

export class NeedFunds extends Error {
  constructor(public readonly balance: bigint) {
    super("Add funds: a paid match needs 1 USDC");
  }
}

export interface PaidEntry {
  /** Relayed enter_arena tx, or null when an unused ticket was reused. */
  ticketTx: string | null;
  /** Signs a fresh NEP-413 join proof: JoinOpts {mode: "paid", join: e.join()}. Call per join. */
  join: () => SignedJoin;
}

/** Throws NeedFunds when the idle balance is below 1 USDC. `onStep` drives the button label. */
export async function payToPlay(accountId: string, onStep: (s: PaidStep) => void = () => {}): Promise<PaidEntry> {
  onStep("quick-play");
  const secret = (await sessionKey(accountId)) ?? (await enableQuickPlay(accountId));

  onStep("ticket");
  let ticketTx: string | null = null;
  const t = await ticketOf(accountId);
  if (t && t.match_id) throw new Error("your last paid match is still settling, try again in a moment");
  if (!t) {
    const bal = await balanceOf(accountId);
    if (bal < BigInt(ENTRY_STAKE)) throw new NeedFunds(bal);
    const r = await enterArena(accountId, secret);
    if (!r.ok) throw new Error(r.error ?? "ticket purchase failed");
    ticketTx = r.hash ?? null;
  }

  onStep("ready");
  return { ticketTx, join: () => signJoin(accountId, secret, "paid") };
}
