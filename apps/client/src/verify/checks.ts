// The Verify page's brain: the same pure core functions the server and the contract use,
// run in the viewer's browser. Nothing here trusts the server: a log is only good if its
// hashes chain, it replays to the books balancing, and its head matches the chain anchor.
import { RULES_VERSION, settle, verifyChain, type LogEntry, type SettleResult } from "@margin/core";

export type Check = { state: "ok" | "bad" | "skip"; detail: string; seq?: number };

export interface Report {
  chain: Check;
  books: Check;
  anchor: Check;
  result: SettleResult | null;
}

/** Run every check on a log; anchorHead is the head stored on NEAR, if known. */
export async function runChecks(log: LogEntry[], anchorHead?: string | null, matchId?: string): Promise<Report> {
  if (log.length === 0) {
    const skip: Check = { state: "skip", detail: "empty log" };
    return { chain: { state: "bad", detail: "The log is empty." }, books: skip, anchor: skip, result: null };
  }
  const bad = await verifyChain(log);
  // The server could answer /verify/X with a clean log of match Y (L4-05): the log must name X.
  const start = log.find((e) => e.type === "MATCH_START");
  const named = start?.type === "MATCH_START" ? start.data.matchId : undefined;
  const chain: Check =
    matchId && named !== matchId
      ? { state: "bad", detail: `This log is for match ${named ?? "(none)"}, not ${matchId}.`, seq: start?.seq }
      : bad === null
      ? { state: "ok", detail: `${log.length} events, every hash links to the one before.` }
      : { state: "bad", detail: `Event #${bad} was changed: its hash no longer matches.`, seq: bad };
  let result: SettleResult | null = null;
  let books: Check;
  try {
    result = settle(log);
    books = { state: "ok", detail: `Replayed every money event under rules v${result.rulesVersion}: not one millionth of a credit created or destroyed.` };
  } catch (e) {
    books = { state: "bad", detail: e instanceof Error ? e.message : String(e) };
  }
  const anchor: Check =
    anchorHead == null
      ? { state: "skip", detail: "Not anchored on NEAR yet (free matches anchor hourly)." }
      : result && result.head === anchorHead
        ? { state: "ok", detail: "The final hash matches the one stored on NEAR." }
        : { state: "bad", detail: "The final hash differs from the one stored on NEAR." };
  // A log with no rules version (before 11 Nov) balances under old rules, but anyone could strip the
  // version from a new log to claim them. Only NEAR holding the same head proves it is a real old match.
  if (result?.legacy && books.state === "ok" && anchor.state !== "ok") {
    books = { state: "skip", detail: `Legacy log, rules version unproven: it balances under rules v${result.rulesVersion} (before 11 Nov), which only counts once NEAR holds the same final hash.` };
  }
  // A log may name an older, looser rule set (L4-04). No real log ever did, so show it as old rules, not green.
  else if (result && !result.legacy && (result.rulesVersion ?? RULES_VERSION) < RULES_VERSION && books.state === "ok") {
    books = { state: "skip", detail: `Old rules: this log names rules v${result.rulesVersion}, not the current v${RULES_VERSION}. It balances under those looser rules only.` };
  }
  // A broken chain voids everything after it, even if the numbers happen to add up.
  if (chain.state === "bad" && books.state === "ok") books = { state: "bad", detail: "Not trusted: the hash chain is broken." };
  return { chain, books, anchor, result };
}
