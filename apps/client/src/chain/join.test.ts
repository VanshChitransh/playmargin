// The join proof must verify exactly as the server will check it (near-kit, no `near` option),
// and must not verify for another room or another account.

import { describe, expect, it } from "vitest";
import { generateKey, verifyNep413Signature } from "near-kit";
import { JOIN_RECIPIENT, joinMessage, signJoin } from "./join";

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function serverCheck(j: ReturnType<typeof signJoin>, roomId: string, accountId = j.accountId) {
  const signed = { accountId, publicKey: j.publicKey, signature: j.signature };
  const params = { message: joinMessage(roomId, accountId), recipient: JOIN_RECIPIENT, nonce: fromB64(j.nonce) };
  return verifyNep413Signature(signed, params, { maxAge: 60_000 });
}

describe("paid join proof", () => {
  const key = generateKey();
  const secret = key.secretKey as `ed25519:${string}`;

  it("verifies for the signed room", async () => {
    const j = signJoin("p.testnet", secret, "room-A");
    expect(j.publicKey).toBe(key.publicKey.toString());
    expect(await serverCheck(j, "room-A")).toBe(true);
  });

  it("fails for another room or another account", async () => {
    const j = signJoin("p.testnet", secret, "room-A");
    expect(await serverCheck(j, "room-B")).toBe(false);
    expect(await serverCheck(j, "room-A", "q.testnet")).toBe(false);
  });
});
