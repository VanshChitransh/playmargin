// NEAR Auth (email login) needs a funded account to send two kinds of calls the player cannot pay
// for: create_account on the registrar (new email player, with a little NEAR for their own gas) and
// sign on the fast-auth contract (the MPC signs a tx after verifying the Auth0 JWT on chain).
// Pure checks live here so vitest covers them; server.ts sends the calls.

export interface SignBody {
  guardId: string;
  verifyPayload: string;
  /** Borsh-encoded Transaction the MPC will sign (the JWT's fatxn claim). */
  signPayload: number[];
}

const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const ED25519 = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** Why a create request is refused, or null. Only `<name>.<registrar>` names: no dots inside. */
export function createError(b: Record<string, unknown>, registrar: string): string | null {
  const id = b.accountId;
  if (typeof id !== "string" || !ACCOUNT.test(id) || !id.endsWith(`.${registrar}`)) return `account must be <name>.${registrar}`;
  if (id.slice(0, -registrar.length - 1).includes(".")) return "no sub-accounts";
  if (typeof b.publicKey !== "string" || !ED25519.test(b.publicKey)) return "ed25519 public key only";
  return null;
}

/** Reads signer_id and receiver_id from a borsh Transaction (V0 layout near-api-js 5 encodes). */
export function txParties(bytes: Uint8Array): { signerId: string; receiverId: string } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (at: number): [string, number] => {
    const n = v.getUint32(at, true);
    if (n > 64 || at + 4 + n > bytes.length) throw new Error("bad string");
    return [new TextDecoder().decode(bytes.subarray(at + 4, at + 4 + n)), at + 4 + n];
  };
  const [signerId, afterSigner] = str(0);
  const keyType = bytes[afterSigner];
  const keyLen = keyType === 0 ? 32 : keyType === 1 ? 64 : -1;
  if (keyLen < 0) throw new Error("bad key type");
  const [receiverId] = str(afterSigner + 1 + keyLen + 8); // key type + key + u64 nonce
  return { signerId, receiverId };
}

/**
 * Why a sign request is refused, or null. The relayer pays ~0.03 NEAR of gas per MPC sign, so it
 * only signs txs from a fast-auth account to our contract, USDC, or itself (adding the session key).
 */
export function signError(b: Record<string, unknown>, guardPrefix: string, receivers: readonly string[]): string | null {
  if (typeof b.guardId !== "string" || !b.guardId.startsWith(guardPrefix)) return "unknown guard";
  if (typeof b.verifyPayload !== "string" || b.verifyPayload.length > 8_192) return "bad jwt";
  const p = b.signPayload;
  if (!Array.isArray(p) || p.length > 4_096 || !p.every((x) => Number.isInteger(x) && x >= 0 && x < 256)) return "bad payload";
  let parties;
  try {
    parties = txParties(Uint8Array.from(p as number[]));
  } catch {
    return "payload is not a transaction";
  }
  const ok = parties.receiverId === parties.signerId || receivers.includes(parties.receiverId);
  return ok ? null : `receiver ${parties.receiverId} not allowed`;
}
