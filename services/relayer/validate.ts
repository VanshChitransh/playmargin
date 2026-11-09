// Allow-list for relayed meta-transactions (NEP-366). The relayer pays gas, so it must only ever
// wrap a gas-bounded, zero-deposit enter_arena call to our contract, signed with an ed25519 key.
// Pure (no near-kit runtime import) so the root vitest run covers it without extra installs.

import type { SignedDelegateAction } from "near-kit";

type SignedDelegate = SignedDelegateAction["signedDelegate"];

export interface Policy {
  contractId: string;
  methods: readonly string[];
  /** Max prepaid gas per call, in gas units. */
  maxGas: bigint;
}

/** Returns why the delegate is refused, or null when it may be relayed. */
export function refuseReason(sd: SignedDelegate, p: Policy): string | null {
  const d = sd.delegateAction;
  if (d.receiverId !== p.contractId) return `receiver must be ${p.contractId}`;
  if (!("ed25519Key" in d.publicKey) || !("ed25519Signature" in sd.signature)) return "ed25519 keys only";
  if (d.actions.length !== 1) return "exactly one action";
  const a = d.actions[0];
  if (!a || !("functionCall" in a)) return "only function calls";
  const fc = a.functionCall;
  if (!p.methods.includes(fc.methodName)) return `method ${fc.methodName} not allowed`;
  if (fc.deposit !== 0n) return "deposit must be 0";
  if (fc.gas > p.maxGas) return "gas above limit";
  return null;
}

/** One relay per sender per window: stops a single account from burning the relayer's NEAR. */
export class RateLimit {
  private last = new Map<string, number>();
  constructor(private windowMs: number) {}

  /** True if `who` may relay at time `now` (ms); records the attempt. */
  allow(who: string, now: number): boolean {
    const prev = this.last.get(who);
    if (prev !== undefined && now - prev < this.windowMs) return false;
    this.last.set(who, now);
    return true;
  }
}
