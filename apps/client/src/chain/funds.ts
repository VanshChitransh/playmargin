// Player money on the contract: idle balance, ticket, deposit, withdraw. Deposits and withdraws
// are full-key wallet actions (withdraw needs 1 yocto, which a session key can never attach).
// On testnet "Get test USDC" mints from the mock token's open faucet (contracts/mock-usdc).

import { CONTRACT_ID, NETWORK, RPC_EXTRA, USDC_ID } from "./config";
import { nearClients, withFallback } from "./rpc";
import { wallet } from "./wallet";

const readers = nearClients(NETWORK, RPC_EXTRA);
const reader = { view: <T>(id: string, method: string, args: object) => withFallback(readers, (n) => n.view<T>(id, method, args)) };

export interface Ticket {
  stake: string;
  entered_at: number;
  match_id: string | null;
}

/** Idle USDC on the contract, in base units (6 decimals). */
export async function balanceOf(accountId: string): Promise<bigint> {
  return BigInt((await reader.view<string>(CONTRACT_ID, "balance_of", { account_id: accountId })) ?? "0");
}

/** USDC in the player's own wallet (not yet deposited), in base units. */
export async function walletUsdc(accountId: string): Promise<bigint> {
  return BigInt((await reader.view<string>(USDC_ID, "ft_balance_of", { account_id: accountId })) ?? "0");
}

export async function ticketOf(accountId: string): Promise<Ticket | null> {
  return (await reader.view<Ticket | null>(CONTRACT_ID, "ticket_of", { account_id: accountId })) ?? null;
}

let stake: Promise<string> | null = null;

/** The paid entry in USDC base units, from the contract's config (owner may set 1 or 0.10 USDC). */
export function entryStake(): Promise<string> {
  stake ??= reader.view<{ entry_stake: string }>(CONTRACT_ID, "config", {}).then((c) => {
    if (!c) throw new Error("contract config unavailable");
    return c.entry_stake;
  });
  stake.catch(() => (stake = null)); // retry next call after a network blip
  return stake;
}

/** Drop the cached stake (the owner changed it): the next entryStake() reads config again. */
export function forgetEntryStake(): void {
  stake = null;
}

const GAS = "100000000000000"; // 100 Tgas: ft_transfer_call / withdraw + their callbacks

/** Moves `amount` base units from the wallet into the contract (credits the same account). */
export async function deposit(accountId: string, amount: bigint): Promise<void> {
  await (await wallet()).signAndSendTransaction({
    signerId: accountId,
    receiverId: USDC_ID,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "ft_transfer_call",
          args: { receiver_id: CONTRACT_ID, amount: amount.toString(), msg: "" },
          gas: GAS,
          deposit: "1",
        },
      },
    ],
  });
}

/**
 * What a withdraw tx returned: the contract's on_withdraw gives true when USDC arrived and false
 * when ft_transfer failed and the balance was re-credited. null = the wallet gave no outcome.
 */
export function withdrawOk(outcome: unknown): boolean | null {
  const status = (outcome as { status?: unknown } | null | undefined)?.status;
  if (!status || typeof status !== "object") return null;
  if ("Failure" in status) return false;
  const v = (status as { SuccessValue?: unknown }).SuccessValue;
  return typeof v === "string" ? atob(v) === "true" : null;
}

/**
 * Sends idle USDC back to the wallet. Needs the full key: 1 yocto keeps session keys out.
 * Throws when the money did not leave: an account not registered on the USDC token makes
 * ft_transfer fail and the contract quietly re-credits the balance (RT L1-05).
 */
export async function withdraw(accountId: string, amount: bigint): Promise<void> {
  const registered = await reader.view<unknown>(USDC_ID, "storage_balance_of", { account_id: accountId });
  if (!registered) {
    throw new Error(
      "Your NEAR account is not registered on the USDC token yet, so it cannot receive USDC. " +
        "Register it once (storage_deposit on USDC, about 0.00125 NEAR, most wallets do it when you first receive USDC), then withdraw. Your balance here is safe.",
    );
  }
  const before = await balanceOf(accountId);
  const out = await (await wallet()).signAndSendTransaction({
    signerId: accountId,
    receiverId: CONTRACT_ID,
    actions: [{ type: "FunctionCall", params: { methodName: "withdraw", args: { amount: amount.toString() }, gas: GAS, deposit: "1" } }],
  });
  // Some wallets return no outcome: then the balance tells the truth.
  const ok = withdrawOk(out) ?? (await balanceOf(accountId)) <= before - amount;
  if (!ok) throw new Error("The withdraw bounced back: USDC could not reach your account, so it is still in your balance here.");
}

/** Testnet only: mint 10 mock USDC to the wallet (open faucet, capped per call by the token). */
export async function testnetFaucet(accountId: string): Promise<void> {
  if (NETWORK !== "testnet") throw new Error("faucet is testnet only");
  await (await wallet()).signAndSendTransaction({
    signerId: accountId,
    receiverId: USDC_ID,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: "mint", args: { account_id: accountId, amount: "10000000" }, gas: "30000000000000", deposit: "0" },
      },
    ],
  });
}
