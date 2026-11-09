// "Quick play": a browser-held ed25519 function-call key that can only call enter_arena on our
// contract. The wallet approves it once, then every paid entry is a relayed NEP-366 delegate with
// no pop-up and no gas for the player. It cannot withdraw (no 1 yocto), proven by
// tools/scripts/session-probe.ts.

import { Near, generateKey, parseKey } from "near-kit";
import { CONTRACT_ID, NETWORK, RELAYER_URL } from "./config";
import { entryStake } from "./funds";
import { wallet } from "./wallet";

/** Explicit allowance (the near-api-js default is 0.25 NEAR). Relaying never spends it. */
const ALLOWANCE_YOCTO = "50000000000000000000000"; // 0.05 NEAR

type Secret = `ed25519:${string}`;

const storageKey = (accountId: string) => `margin.session.${NETWORK}.${accountId}`;

function load(accountId: string): Secret | null {
  try {
    return localStorage.getItem(storageKey(accountId)) as Secret | null;
  } catch {
    return null;
  }
}

function save(accountId: string, secret: Secret): void {
  try {
    localStorage.setItem(storageKey(accountId), secret);
  } catch {
    // Private mode: the key lives for this tab only and quick play asks again next visit.
  }
}

const memory = new Map<string, Secret>();
const reader = new Near({ network: NETWORK });

/** The stored session key, if it is still an access key on the account (user may have removed it). */
export async function sessionKey(accountId: string): Promise<Secret | null> {
  const secret = memory.get(accountId) ?? load(accountId);
  if (!secret) return null;
  const onChain = await reader.getAccessKey(accountId, parseKey(secret).publicKey.toString());
  return onChain ? secret : null;
}

/** One wallet approval: adds a key that may only call enter_arena on our contract. */
export async function enableQuickPlay(accountId: string): Promise<Secret> {
  const key = generateKey();
  const secret = key.secretKey as Secret;
  await (await wallet()).signAndSendTransaction({
    signerId: accountId,
    receiverId: accountId,
    actions: [
      {
        type: "AddKey",
        params: {
          publicKey: key.publicKey.toString(),
          accessKey: { permission: { receiverId: CONTRACT_ID, methodNames: ["enter_arena"], allowance: ALLOWANCE_YOCTO } },
        },
      },
    ],
  });
  memory.set(accountId, secret);
  save(accountId, secret);
  return secret;
}

export interface RelayResult {
  ok: boolean;
  hash?: string;
  logs?: string[];
  error?: string;
}

/** Buys a ticket at the contract's entry stake with the session key via the relayer. No pop-up, no gas. */
export async function enterArena(accountId: string, secret: Secret, relayerUrl = RELAYER_URL): Promise<RelayResult> {
  const signer = new Near({ network: NETWORK, privateKey: secret, defaultSignerId: accountId });
  const { payload } = await signer
    .transaction(accountId)
    .functionCall(CONTRACT_ID, "enter_arena", { stake: await entryStake() }, { gas: "30 Tgas" })
    .delegate({ blockHeightOffset: 100 });
  const res = await fetch(`${relayerUrl}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  return (await res.json()) as RelayResult;
}

