// Email login (NEAR Auth / fast-auth), only when VITE_NEAR_AUTH=1. The account's full key is an
// MPC key derived from the Auth0 user, so every full-key tx is: Auth0 popup -> our relayer sends
// fast-auth `sign` (it pays the MPC gas) -> we broadcast. New players get <name>.testnet|near
// created and funded by the relayer. near-api-js 5 + Auth0 load only when this module is imported.

import "./buffer-shim";
import { FastAuthClient, FastAuthSignature, type FastAuthSigner } from "@fast-auth-near/browser-sdk";
import { JavascriptProvider } from "@fast-auth-near/javascript-provider";
import { providers, utils } from "near-api-js";
import { addKey, createTransaction, functionCall, functionCallAccessKey, type Action } from "near-api-js/lib/transaction";
import { NETWORK, RELAYER_URL } from "./config";

const env: Partial<ImportMetaEnv> = import.meta.env ?? {};
export const EMAIL_LOGIN = env.VITE_NEAR_AUTH === "1";

const NET = {
  testnet: { clientId: "np8paqIpMWmNbzT4xAvOOapZBjsOpptl", fastAuth: "fast-auth.testnet", mpc: "v1.signer-prod.testnet", rpc: "https://rpc.testnet.near.org", lookup: "https://test.api.fastnear.com" },
  mainnet: { clientId: env.VITE_NEAR_AUTH_CLIENT_ID ?? "", fastAuth: "fast-auth.near", mpc: "v1.signer", rpc: "https://rpc.mainnet.near.org", lookup: "https://api.fastnear.com" },
}[NETWORK];
const REGISTRAR = NETWORK === "mainnet" ? "near" : "testnet";

/** Auth0 only allows registered callbacks: the shared testnet app allows exactly http://localhost:3000. */
export const REDIRECT_URI = env.VITE_NEAR_AUTH_REDIRECT ?? (NETWORK === "mainnet" ? "https://playmargin.fun/auth/callback" : "http://localhost:3000");
const LOGOUT_URI = NETWORK === "mainnet" ? "https://playmargin.fun" : "http://localhost:3000";

const rpc = new providers.JsonRpcProvider({ url: NET.rpc });
const provider = new JavascriptProvider({ network: NETWORK, clientId: NET.clientId });
const client = new FastAuthClient(provider, { provider: rpc } as never, { fastAuthContractId: NET.fastAuth, mpcContractId: NET.mpc });

let signer: FastAuthSigner<JavascriptProvider> | null = null;
let account: { id: string; publicKey: string } | null = null;

/** Starts email login: leaves the page for Auth0, which comes back to REDIRECT_URI. */
export async function emailSignIn(): Promise<void> {
  await provider.login({ redirectUri: REDIRECT_URI });
}

export async function emailSignOut(): Promise<void> {
  signer = null;
  account = null;
  await provider.logout({ logoutParams: { returnTo: LOGOUT_URI } });
}

async function post(path: string, body: object): Promise<Record<string, string>> {
  const r = await fetch(`${RELAYER_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as Record<string, string>;
  if (!r.ok) throw new Error(j.error ?? `relayer ${r.status}`);
  return j;
}

/**
 * Run on page load (and on /auth/callback). Returns the NEAR account if logged in, or
 * {needsName: true} for a brand new player, who then picks a name via emailCreateAccount.
 */
export async function emailSession(): Promise<{ accountId: string } | { needsName: true } | null> {
  if (!(await provider.isLoggedIn())) return null;
  signer ??= await client.getSigner();
  const publicKey = (await signer.getPublicKey()).toString();
  const r = await fetch(`${NET.lookup}/v0/public_key/${publicKey}`).then((x) => x.json() as Promise<{ account_ids?: string[] }>, () => ({ account_ids: [] }));
  // Public keys are public: anyone can add ours to THEIR account to hijack this lookup. Only an
  // account whose every full-access key is this player's MPC key belongs to the player.
  let id: string | undefined;
  for (const cand of r.account_ids ?? []) {
    const keys = (await rpc.query({ request_type: "view_access_key_list", finality: "final", account_id: cand })) as unknown as {
      keys: { public_key: string; access_key: { permission: unknown } }[];
    };
    const full = keys.keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
    if (full.length > 0 && full.every((k) => k === publicKey)) {
      id = cand;
      break;
    }
  }
  if (!id) {
    account = { id: "", publicKey };
    return { needsName: true };
  }
  account = { id, publicKey };
  return { accountId: id };
}

/** Creates `<name>.testnet|near` keyed to the player's MPC key (the relayer pays and funds it). */
export async function emailCreateAccount(name: string): Promise<string> {
  if (!account) throw new Error("log in with email first");
  const id = `${name.toLowerCase()}.${REGISTRAR}`;
  await post("/fastauth/create", { accountId: id, publicKey: account.publicKey });
  account.id = id;
  return id;
}

/** near-connect action shape (what session.ts and funds.ts build) -> near-api-js action. */
export type WalletAction =
  | { type: "FunctionCall"; params: { methodName: string; args: object; gas: string; deposit: string } }
  | { type: "AddKey"; params: { publicKey: string; accessKey: { permission: { receiverId: string; methodNames: string[]; allowance: string } } } };

function toAction(a: WalletAction): Action {
  if (a.type === "FunctionCall") return functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit));
  const p = a.params.accessKey.permission;
  return addKey(utils.PublicKey.from(a.params.publicKey), functionCallAccessKey(p.receiverId, p.methodNames, BigInt(p.allowance)));
}

/** Same call shape as a near-connect wallet: one Auth0 popup per tx (call it from a click). */
export interface WalletTx {
  signerId: string;
  receiverId: string;
  actions: WalletAction[];
}

export const emailWallet = {
  async signAndSendTransaction(t: WalletTx): Promise<unknown> {
    if (!signer || !account?.id) throw new Error("log in with email first");
    const pk = utils.PublicKey.from(account.publicKey);
    const q = { request_type: "view_access_key", finality: "final", account_id: account.id, public_key: account.publicKey };
    const key = (await rpc.query(q)) as unknown as { nonce: number; block_hash: string };
    const tx = createTransaction(account.id, pk, t.receiverId, BigInt(key.nonce) + 1n, t.actions.map(toAction), utils.serialize.base_decode(key.block_hash));
    await signer.requestTransactionSignature({ transaction: tx });
    const { signatureRequest } = await signer.getSignatureRequest();
    const { signature } = await post("/fastauth/sign", { ...signatureRequest, signPayload: Array.from(signatureRequest.signPayload) });
    return signer.sendTransaction(tx, FastAuthSignature.fromBase64(signature ?? ""));
  },
};
