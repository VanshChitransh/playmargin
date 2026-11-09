// Allow-list for relayed meta-transactions (NEP-366). The relayer pays gas, so it must only ever
// wrap a gas-bounded, zero-deposit enter_arena call to our contract, signed with an ed25519 key.
// Checks run BEFORE the relayer pays: shape (refuseReason), a locally verified signature
// (signatureOk) and the signer's key on chain (keyAllows), so junk costs us nothing (CSO H1).

import { createHash, createPublicKey, verify } from "node:crypto";
import { base58 } from "@scure/base";
import { DELEGATE_ACTION_PREFIX, type SignedDelegateAction } from "near-kit";

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

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

/** The delegate's public key as NEAR prints it ("ed25519:<base58>"), or null for other curves. */
export function delegateKey(sd: SignedDelegate): string | null {
  const k = sd.delegateAction.publicKey;
  return "ed25519Key" in k ? `ed25519:${base58.encode(Uint8Array.from(k.ed25519Key.data))}` : null;
}

/**
 * NEP-366: ed25519 over sha256(u32 LE prefix || borsh(DelegateAction)), checked on the raw payload
 * (borsh SignedDelegate = DelegateAction bytes, then 1 key-type byte + 64 signature bytes).
 * `sd` is the decoded payload, used only for its public key. Forged payloads stop here.
 */
export function signatureOk(payloadB64: string, sd: SignedDelegate): boolean {
  const k = sd.delegateAction.publicKey;
  const bytes = Buffer.from(payloadB64, "base64");
  if (!("ed25519Key" in k) || bytes.length < 66 || bytes[bytes.length - 65] !== 0) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(k.ed25519Key.data)]), format: "der", type: "spki" });
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(DELEGATE_ACTION_PREFIX);
    const msg = createHash("sha256").update(Buffer.concat([prefix, bytes.subarray(0, bytes.length - 65)])).digest();
    return verify(null, msg, key, bytes.subarray(bytes.length - 64));
  } catch {
    return false;
  }
}

/** On-chain access key view (near-kit getAccessKey). */
export type KeyView = { nonce: number | bigint; permission: "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[] } } };

/** Why the signer's key cannot run this delegate now, or null. Replays and expired delegates fail too. */
export function keyRefusal(sd: SignedDelegate, key: KeyView | null, height: bigint, contractId: string, method: string): string | null {
  const { nonce, maxBlockHeight } = sd.delegateAction;
  if (maxBlockHeight <= height) return "delegate expired";
  if (!key) return "unknown key for this account";
  if (nonce <= BigInt(key.nonce)) return "nonce already used";
  if (key.permission === "FullAccess") return null;
  const fc = key.permission.FunctionCall;
  if (fc.receiver_id !== contractId) return "key not scoped to the contract";
  if (fc.method_names.length > 0 && !fc.method_names.includes(method)) return "key cannot call this method";
  return null;
}

/** One action per key per window. Old entries are pruned so spoofed keys cannot grow it forever. */
export class RateLimit {
  private last = new Map<string, number>();
  constructor(private windowMs: number) {}

  /** True if `who` may relay at time `now` (ms); records the attempt. */
  allow(who: string, now: number): boolean {
    const prev = this.last.get(who);
    if (prev !== undefined && now - prev < this.windowMs) return false;
    if (this.last.size > 10_000) for (const [k, t] of this.last) if (now - t >= this.windowMs) this.last.delete(k);
    this.last.set(who, now);
    return true;
  }
}

/** At most `cap` paid actions per fixed window (a minute, a day), so a flood cannot empty the relayer. */
export class WindowCap {
  private start = -Infinity;
  private n = 0;
  /** Last time the cap refused something (ms), for the /health alarm. */
  hitAt = -Infinity;
  constructor(private cap: number, private windowMs: number) {}

  /** True and counts one, unless this window's cap is used up. `now` in ms. */
  take(now: number): boolean {
    if (now - this.start >= this.windowMs) [this.start, this.n] = [now - (now % this.windowMs), 0];
    if (this.n >= this.cap) {
      this.hitAt = now;
      return false;
    }
    this.n++;
    return true;
  }
}
