// Creates funded sub-accounts of the contract account. The new full-access key is saved to
// ~/.near-credentials before the account exists, so a crash never leaves an unusable account.

import { generateKey } from "near-kit";
import { IDS, keyStore, near, txLink } from "./net.ts";

/** Creates `id` funded with `deposit` unless it already exists (never recreates accounts). */
export async function ensureSubAccount(id: string, deposit: `${number} NEAR`): Promise<void> {
  if (await near.accountExists(id)) return;
  const key = generateKey();
  await keyStore.add(id, key);
  const r = await near
    .transaction(IDS.contract)
    .createAccount(id)
    .transfer(id, deposit)
    .addKey(key.publicKey.toString(), { type: "fullAccess" })
    .send();
  console.log(`created ${id}: ${txLink(r)}`);
}
