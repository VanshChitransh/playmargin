// Wallet login via near-connect (HOT, Meteor, Intear, ...). MyNearWallet is excluded: it is
// sunsetting (Telegram lessons). The UI calls this "Profile", never "wallet connect".

import { NearConnector } from "@hot-labs/near-connect";
import { NETWORK } from "./config";

type Listener = (accountId: string | null) => void;

let connector: NearConnector | null = null;
let current: string | null = null;
const listeners = new Set<Listener>();

function emit(id: string | null): void {
  current = id;
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
  await get().disconnect();
  emit(null);
}

/** Subscribes to login changes; fires immediately with the current account. Returns unsubscribe. */
export function onAccount(l: Listener): () => void {
  get();
  listeners.add(l);
  l(current);
  return () => listeners.delete(l);
}

/** The connected wallet, for actions only a full key may sign (add session key, withdraw, deposit). */
export async function wallet() {
  return get().wallet();
}
