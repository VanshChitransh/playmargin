// The name a player enters the arena with, kept in this browser. A typed name wins; otherwise
// the NEAR account they last signed in with (wallet.ts records it), so a signed-in player is
// "you.testnet" or "you.near" even in practice. The server cleans it again on join.
import { cleanName } from "@margin/core";

const NAME = "margin.name";
const ACCOUNT = "margin.account";

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null; // storage blocked (private mode): play as "Player N"
  }
};
const write = (k: string, v: string | null): void => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* storage blocked: the name just isn't remembered */
  }
};

/** The signed-in NEAR account, if any (testnet or mainnet, whichever this build runs on). */
export const signedInAccount = (): string | null => read(ACCOUNT);
export const rememberAccount = (id: string | null): void => write(ACCOUNT, id);

/** The name to play with, or null for a server-assigned "Player N". */
export const playerName = (): string | null => cleanName(read(NAME)) ?? cleanName(signedInAccount());

/** Save what the player typed (an empty box falls back to the account). Returns the cleaned name. */
export function setPlayerName(raw: string): string | null {
  const n = cleanName(raw);
  write(NAME, n);
  return n;
}
