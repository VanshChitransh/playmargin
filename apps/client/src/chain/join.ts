// Paid join proof (S2 ICR): the session key signs a NEP-413 message naming the room, so the
// server knows the joining socket controls the account whose ticket it seats. No wallet pop-up.
// Server check: verifyNep413Signature WITHOUT `near` (near-kit's on-chain check demands a
// full-access key), then view_access_key must be our enter_arena function-call key.

import { generateNonce, parseKey } from "near-kit";
import { CONTRACT_ID } from "./config";

/** What the client sends with a paid join (JoinOpts). Nonce is base64 of the 32 NEP-413 bytes. */
export interface SignedJoin {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
  message: string;
}

/** The exact NEP-413 message. NEP-413 does not sign the account id, so it goes in the message;
 *  the server rebuilds this from ITS roomId and the claimed account, never from client text. */
export const joinMessage = (roomId: string, accountId: string) => `margin-join:${roomId}:${accountId}`;

/** NEP-413 recipient: the contract id, so a signature can't be replayed against another app. */
export const JOIN_RECIPIENT = CONTRACT_ID;

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** Signs a join for `roomId` with the quick-play session key. Valid ~60 s (timestamped nonce). */
export function signJoin(accountId: string, secret: `ed25519:${string}`, roomId: string): SignedJoin {
  const nonce = generateNonce();
  const message = joinMessage(roomId, accountId);
  const kp = parseKey(secret);
  if (!kp.signNep413Message) throw new Error("session key cannot sign NEP-413");
  const s = kp.signNep413Message(accountId, { message, recipient: JOIN_RECIPIENT, nonce });
  return { accountId, publicKey: s.publicKey, signature: s.signature, nonce: toB64(nonce), message };
}
