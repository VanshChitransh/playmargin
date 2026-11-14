// The judges' desk verdicts: pure functions from what NEAR returned to OK / FAIL / NONE YET.
// The page (screens/judges.ts) only fetches and draws; every rule that decides a status lives
// here, so it is unit tested and a judge can read exactly what each check demands.

export type State = "ok" | "fail" | "none" | "unreachable";
export interface Verdict {
  state: State;
  detail: string;
}

/** "1 player", "2 players", "0 matches": every count on the page goes through this (QA-E-17). */
export const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** USDC base units (6 decimals) as a short display number. */
export const usdc = (base: string | number): string => (Number(base) / 1e6).toLocaleString("en", { maximumFractionDigits: 6 });

/** A tx as the NEAR "tx" RPC returns it: just the fields the checks read. */
export interface RawTx {
  transaction: { signer_id: string; receiver_id: string; actions: Array<Record<string, unknown> | string> };
  receipts_outcome: Array<{ outcome: { status: unknown } }>;
}

const failed = (tx: RawTx): boolean => tx.receipts_outcome.some((r) => JSON.stringify(r.outcome.status).includes("Failure"));
const b64json = (s: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))));

/** The first FunctionCall of a tx with its args decoded, or null. */
export function firstCall(tx: RawTx): { method: string; args: Record<string, unknown> } | null {
  for (const a of tx.transaction.actions) {
    const fc = typeof a === "object" ? (a.FunctionCall as { method_name: string; args: string } | undefined) : undefined;
    if (fc) return { method: fc.method_name, args: b64json(fc.args) };
  }
  return null;
}

export function configVerdict(c: { owner: string; settler: string; usdc: string; entry_stake: string }, expectUsdc: string): Verdict {
  if (c.usdc !== expectUsdc) return { state: "fail", detail: `The contract takes ${c.usdc}, not the USDC this site uses (${expectUsdc}).` };
  if (!(Number(c.entry_stake) > 0)) return { state: "fail", detail: "The contract has no paid entry set." };
  return { state: "ok", detail: `Owner ${c.owner}, settler ${c.settler}, takes USDC ${c.usdc}, one paid entry is ${usdc(c.entry_stake)} USDC.` };
}

/** A settle tx is good when it succeeded and the contract still holds that match as Settled with the same head. */
export function settleVerdict(tx: RawTx, onChain: { status: string; head: string; stakes: string } | null): Verdict {
  const call = firstCall(tx);
  if (!call || call.method !== "settle") return { state: "fail", detail: "That transaction is not a settle." };
  if (failed(tx)) return { state: "fail", detail: "The settle transaction failed on NEAR." };
  const a = call.args as { match_id: string; lent: string; vault_repaid: string; head: string; payouts: [string, string][] };
  if (!onChain) return { state: "fail", detail: `NEAR has no record of match ${a.match_id}.` };
  if (onChain.status !== "Settled" || onChain.head !== a.head) return { state: "fail", detail: "The contract's record of this match does not match the settle." };
  return {
    state: "ok",
    detail: `Match ${a.match_id}: ${usdc(onChain.stakes)} USDC staked, ${usdc(a.lent)} lent by the vault and ${usdc(a.vault_repaid)} repaid, ${a.payouts.length ? count(a.payouts.length, "payout") : "no survivor, so the leftover went to the vault"}. The contract checked the books balance exactly before it paid, and stored the log head ${a.head.slice(0, 10)}...`,
  };
}

/** The drone is a registered house agent and the bounty tx paid it through settle. */
export function droneVerdict(drone: string, isAgent: boolean, balance: string, tx: RawTx): Verdict {
  const call = firstCall(tx);
  const paid = (call?.args.payouts as [string, string][] | undefined)?.find(([who]) => who === drone);
  if (!isAgent) return { state: "fail", detail: `${drone} is not a registered house agent.` };
  if (!call || call.method !== "settle" || failed(tx) || !paid) return { state: "fail", detail: `That settle did not pay ${drone}.` };
  return { state: "ok", detail: `${drone} is registered, earned ${usdc(paid[1])} USDC popping a red player in that match, and holds ${usdc(balance)} USDC in the contract now. All agent payouts in a match are capped at 12% of its stakes.` };
}

/** The session key may call enter_arena on our contract and nothing else (withdraw needs 1 yocto, which a function-call key can never attach). */
export function sessionKeyVerdict(permission: unknown, contract: string): Verdict {
  const fc = (permission as { FunctionCall?: { receiver_id: string; method_names: string[]; allowance: string | null } })?.FunctionCall;
  if (!fc) return { state: "fail", detail: "That key is a full-access key." };
  if (fc.receiver_id !== contract) return { state: "fail", detail: `That key calls ${fc.receiver_id}, not ${contract}.` };
  if (fc.method_names.length !== 1 || fc.method_names[0] !== "enter_arena") return { state: "fail", detail: `That key may call ${fc.method_names.join(", ") || "any method"}.` };
  const gas = fc.allowance ? ` Its gas allowance is ${(Number(fc.allowance) / 1e24).toFixed(3)} NEAR.` : "";
  return { state: "ok", detail: `The key can only call enter_arena on ${contract}. withdraw needs 1 yoctoNEAR attached, which a function-call key can never send, so a stolen key cannot take money out.${gas}` };
}

/** A relayed ticket: our relayer paid gas for a zero-deposit enter_arena signed by the player. */
export function relayVerdict(tx: RawTx, contract: string): Verdict {
  const d = tx.transaction.actions.map((a) => (typeof a === "object" ? (a.Delegate as { delegate_action: { sender_id: string; receiver_id: string; actions: Array<{ FunctionCall?: { method_name: string; deposit: string } }> } } | undefined) : undefined)).find(Boolean);
  if (!d) return { state: "fail", detail: "That transaction is not a NEP-366 delegate." };
  const inner = d.delegate_action;
  const onlyEnter = inner.actions.every((x) => x.FunctionCall?.method_name === "enter_arena" && x.FunctionCall.deposit === "0");
  if (inner.receiver_id !== contract || !onlyEnter) return { state: "fail", detail: "The relayed action is not a zero-deposit enter_arena on our contract." };
  if (failed(tx)) return { state: "fail", detail: "The relayed transaction failed on NEAR." };
  return { state: "ok", detail: `${tx.transaction.signer_id} paid the gas, ${inner.sender_id} signed only a zero-deposit enter_arena on ${contract}: one PLAY press, no wallet pop-up.` };
}

/** The newest hourly anchor of free matches. */
export function anchorVerdict(a: { seq: number; head: string; at: number } | null, nowMs: number): Verdict {
  if (!a) return { state: "none", detail: "No hourly anchor on this contract yet." };
  const hours = Math.max(0, (nowMs - a.at / 1e6) / 3.6e6);
  const ago = hours < 1 ? `${Math.round(hours * 60)} min ago` : `${hours.toFixed(1)} h ago`;
  return { state: "ok", detail: `Latest hourly root #${a.seq}, ${a.head.slice(0, 12)}..., written ${ago}. The seq can only grow, so this root cannot be replaced. It proves those logs were not changed after this hour, not that the matches were played fairly.` };
}
