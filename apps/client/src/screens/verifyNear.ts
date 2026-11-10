// "Anchored on NEAR", checked against NEAR itself (QA-C-02): the page says "do not trust us", so the
// server only hands over pointers (a tx hash, a Merkle proof) and every fact is read from the chain.
// Paid: match_of on the contract must hold the same head the log replays to. Free: the root rebuilt
// from the proof must be exactly what the settler's anchor tx for that hour wrote. Network and
// contract come from this build's own config, never from the server.
import { rootFromProof, type ProofStep } from "@margin/core";
import type { Check } from "../verify/checks";
import { CONTRACT_ID, NETWORK, type Network } from "../chain/config";

export interface NearReaders {
  view<T>(network: Network, contractId: string, method: string, args: object): Promise<{ value: T; rpc: string }>;
  tx(network: Network, txHash: string, signerId: string): Promise<{ method: string; args: unknown; status: "ok" | "failed"; block: number; rpc: string }>;
}

/** What the server says about the match: pointers only, every one is checked on chain. */
export interface AnchorClaim {
  mode: "free" | "paid";
  matchId: string;
  /** Free: the hourly anchor (hour, Merkle proof, anchor tx). Null until the hour is anchored. */
  anchor?: { hour: number; proof: ProofStep[]; tx: string | null } | null;
}

export type NearCheck = Check & { rpc?: string };
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** The anchor check for a replayed head, read from NEAR. Skips (never passes) when there is nothing to read yet. */
export async function anchorOnNear(head: string, claim: AnchorClaim, near: NearReaders, net: Network = NETWORK, contract: string = CONTRACT_ID): Promise<NearCheck> {
  try {
    if (claim.mode === "paid") {
      const { value, rpc } = await near.view<{ status?: string; head?: string } | null>(net, contract, "match_of", { match_id: claim.matchId });
      const via = ` Read from NEAR via ${host(rpc)}.`;
      if (!value) return { state: "skip", detail: `NEAR has no record of this match yet.${via}`, rpc };
      if (value.head !== head) return { state: "bad", detail: `NEAR holds a different final hash for this match.${via}`, rpc };
      return value.status === "Settled" // contract MatchStatus: Open | Settled | Cancelled
        ? { state: "ok", detail: `The final hash matches the one the contract stored when it paid out.${via}`, rpc }
        : { state: "skip", detail: `Same hash on NEAR, but the contract has not settled it yet (${value.status}).${via}`, rpc };
    }
    const a = claim.anchor;
    if (!a?.tx) return { state: "skip", detail: "Not anchored on NEAR yet (free matches anchor once their hour is over)." };
    const root = await rootFromProof(head, a.proof);
    const t = await near.tx(net, a.tx, `settler.${contract}`);
    const via = ` Read from NEAR via ${host(t.rpc)}, block ${t.block}.`;
    const args = t.args as { room_id?: string; seq?: number; head?: string } | null;
    if (t.status !== "ok" || t.method !== "anchor") return { state: "bad", detail: `That transaction is not a successful anchor.${via}`, rpc: t.rpc };
    if (args?.room_id !== "free" || args.seq !== a.hour) return { state: "bad", detail: `The anchor transaction is for another hour.${via}`, rpc: t.rpc };
    if (args.head !== root) return { state: "bad", detail: `This match is not in the root anchored for its hour.${via}`, rpc: t.rpc };
    return { state: "ok", detail: `This match is inside the Merkle root the settler anchored for its hour.${via}`, rpc: t.rpc };
  } catch (e) {
    // Every RPC failed: say so plainly, never turn it into a pass or a fake mismatch.
    return { state: "skip", detail: `Could not reach NEAR to check (${(e as Error).message.slice(0, 80)}). Try again in a minute.` };
  }
}
