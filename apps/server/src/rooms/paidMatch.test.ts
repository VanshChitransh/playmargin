// Paid join proof: only a fresh, unused signature by a contract-scoped key of the claimed account passes.
import { generateKey, generateNonce } from "near-kit";
import { describe, expect, it } from "vitest";
import type { Chain } from "../settlement/chain";
import { joinMessage, verifyJoin } from "./paidMatch";

const CONTRACT = "playmargin.testnet";
const kp = generateKey();
const pub = kp.publicKey.toString();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

function sign(accountId: string, message = joinMessage("paid", accountId), recipient = CONTRACT) {
  const nonce = generateNonce();
  const s = kp.signNep413Message!(accountId, { message, recipient, nonce });
  return { accountId, publicKey: s.publicKey, signature: s.signature, nonce: b64(nonce), message };
}

const chain = (permission: unknown) =>
  ({
    cfg: { contractId: CONTRACT },
    accessKey: async (_a: string, k: string) => (k === pub ? { permission } : null),
  }) as unknown as Chain;
const session = chain({ FunctionCall: { receiver_id: CONTRACT, method_names: ["enter_arena"] } });

describe("verifyJoin", () => {
  it("accepts a session-key join once, then refuses the replay", async () => {
    const j = sign("alice.testnet");
    await expect(verifyJoin(session, j)).resolves.toBe("alice.testnet");
    await expect(verifyJoin(session, j)).rejects.toThrow(/already used/);
  });
  it("accepts a full-access key", async () => {
    await expect(verifyJoin(chain("FullAccess"), sign("bob.testnet"))).resolves.toBe("bob.testnet");
  });
  it("refuses a proof for another account, another app, or an unknown key", async () => {
    const forAlice = sign("alice.testnet");
    await expect(verifyJoin(session, { ...forAlice, accountId: "mallory.testnet" })).rejects.toThrow(/signature/);
    await expect(verifyJoin(session, sign("carol.testnet", undefined, "evil.testnet"))).rejects.toThrow(/signature/);
    await expect(verifyJoin(chain({ FunctionCall: { receiver_id: "other.testnet" } }), sign("dan.testnet"))).rejects.toThrow(/not a key/);
    await expect(verifyJoin(session, undefined)).rejects.toThrow(/signed/);
  });
  it("refuses an expired proof", async () => {
    await expect(verifyJoin(session, sign("erin.testnet"), Date.now())).resolves.toBe("erin.testnet");
    // maxAge is checked inside near-kit against the real clock; a nonce older than 60 s fails there
    const old = new Uint8Array(32);
    new DataView(old.buffer).setBigUint64(0, BigInt(Date.now() - 120_000));
    const s = kp.signNep413Message!("fay.testnet", { message: joinMessage("paid", "fay.testnet"), recipient: CONTRACT, nonce: old });
    await expect(verifyJoin(session, { accountId: "fay.testnet", publicKey: s.publicKey, signature: s.signature, nonce: b64(old) })).rejects.toThrow(/expired/);
  });
});
