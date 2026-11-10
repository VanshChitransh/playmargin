// Wallet login via near-connect (HOT, Meteor, Intear, ...). MyNearWallet is excluded: it is
// sunsetting (Telegram lessons). The UI calls this "Profile", never "wallet connect".
// With VITE_NEAR_AUTH=1 players can also log in with email (email.ts, loaded only on use).

import { NearConnector } from "@hot-labs/near-connect";
import { NETWORK } from "./config";
import { rememberAccount } from "../player/name";
import type { WalletTx } from "./email";

type Listener = (accountId: string | null) => void;

let connector: NearConnector | null = null;
let current: string | null = null;
let email: typeof import("./email") | null = null;
let viaEmail = false;

const env: Partial<ImportMetaEnv> = import.meta.env ?? {};
/** Show the "Log in with email" button only when this is true. */
export const EMAIL_LOGIN = env.VITE_NEAR_AUTH === "1";
const listeners = new Set<Listener>();

function emit(id: string | null): void {
  current = id;
  rememberAccount(id); // so practice and free rooms use the account name without loading wallet code
  for (const l of listeners) l(id);
}

/** Lazily builds the connector so free players never load wallet code. Restores a session. */
function get(): NearConnector {
  if (connector) return connector;
  connector = new NearConnector({ network: NETWORK, excludedWallets: ["mynearwallet"] });
  connector.on("wallet:signIn", (e) => emit(e.accounts[0]?.accountId ?? null));
  connector.on("wallet:signOut", () => emit(null));
  connector
    .getConnectedWallet()
    .then(({ accounts }) => emit(accounts[0]?.accountId ?? null))
    .catch(() => emit(null));
  return connector;
}

/** Opens the wallet picker; resolves with the signed-in account id. */
export async function signIn(): Promise<string> {
  const wallet = await get().connect();
  const [acc] = await wallet.getAccounts({ network: NETWORK });
  if (!acc) throw new Error("wallet returned no account");
  emit(acc.accountId);
  return acc.accountId;
}

export async function signOut(): Promise<void> {
  if (viaEmail && email) {
    viaEmail = false;
    emit(null);
    return email.emailSignOut();
  }
  await get().disconnect();
  emit(null);
}

/** Email login, step 1: leaves the page for Auth0, which returns to /auth/callback. */
export async function signInEmail(): Promise<void> {
  await (email ??= await import("./email")).emailSignIn();
}

/**
 * Email login, step 2: call on every page load when EMAIL_LOGIN (cheap no-op if not logged in).
 * "needs-name" = new player: show a name field, then createEmailAccount(name).
 */
export async function resumeEmail(): Promise<"in" | "needs-name" | "out"> {
  if (!EMAIL_LOGIN) return "out";
  email ??= await import("./email");
  const s = await email.emailSession();
  if (!s) return "out";
  if ("needsName" in s) return "needs-name";
  viaEmail = true;
  emit(s.accountId);
  return "in";
}

/** Email login, step 3 (new players only): creates <name>.testnet|near, free for the player. */
export async function createEmailAccount(name: string): Promise<string> {
  email ??= await import("./email");
  const id = await email.emailCreateAccount(name);
  viaEmail = true;
  emit(id);
  return id;
}

/** Subscribes to login changes; fires immediately with the current account. Returns unsubscribe. */
export function onAccount(l: Listener): () => void {
  get();
  listeners.add(l);
  l(current);
  return () => listeners.delete(l);
}

/** The signer for full-key actions (add session key, withdraw, deposit): wallet or email. */
export async function wallet(): Promise<{ signAndSendTransaction: (t: WalletTx) => Promise<unknown> }> {
  if (viaEmail && email) return email.emailWallet;
  return (await get().wallet()) as unknown as { signAndSendTransaction: (t: WalletTx) => Promise<unknown> };
}
