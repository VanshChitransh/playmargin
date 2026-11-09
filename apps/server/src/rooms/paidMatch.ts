// Admission to a paid room: the account must hold an unassigned ticket on the contract (made by
// enter_arena through the relayer). The stake already sits in that ticket, so nothing is charged here.
// ponytail: account ownership is not proven yet (anyone can name an account with a ticket and play
// it badly; payouts still go to the owner). Fix: NEP-413 signed join, see board ICR.
import { isValidAccountId } from "near-kit";
import { sharedChain } from "../settlement";

interface Ticket {
  match_id: string | null;
}

/** The joining NEAR account; throws (join refused) without a live, unassigned ticket. */
export async function admitPaid(opts: unknown): Promise<{ accountId: string }> {
  const accountId = (opts as { accountId?: unknown } | null)?.accountId;
  if (typeof accountId !== "string" || !isValidAccountId(accountId)) throw new Error("paid mode needs a NEAR accountId");
  const chain = sharedChain();
  if (!chain) throw new Error("paid mode is off on this server");
  const t = await chain.view<Ticket | null>("ticket_of", { account_id: accountId });
  if (!t) throw new Error("no ticket: enter the arena first (1 USDC)");
  if (t.match_id) throw new Error("ticket already in a match");
  return { accountId };
}
