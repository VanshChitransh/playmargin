// #/cash: the $1 match. Sign in, see your balance, PLAY $1 (S4 payToPlay: quick-play key, ticket,
// then a paid seat), or Add funds from any chain through 1-Click dry quotes. Chain words stay out:
// the player sees "balance", "ticket" and "Add funds", never keys or transactions.
import { EXPLORER, NETWORK } from "../chain/config";
import { originTokens, quoteDeposit, type OriginToken } from "../chain/addfunds";
import { balanceOf, deposit, testnetFaucet, walletUsdc } from "../chain/funds";
import { NeedFunds, payToPlay, type PaidStep } from "../chain/paid";
import { onAccount, signIn, signOut } from "../chain/wallet";
import { setPaidSeat } from "../play";
import type { Screen } from "../router";

const STEP: Record<PaidStep, string> = { "quick-play": "Approve quick play", ticket: "Buying ticket", ready: "Joining" };
const usd = (base: bigint): string => (Number(base) / 1e6).toFixed(2);
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const btn = "sticker sticker-press rounded-box px-5 py-3 font-display text-xl disabled:opacity-50";

export const cash: Screen = (root) => {
  root.innerHTML = `
  <div class="min-h-full bg-liq px-4 py-8 text-ink">
    <div class="mx-auto max-w-xl">
      <a href="#/" class="tag">← MARGIN</a>
      <h1 class="outlined mt-3 font-display text-6xl text-paper">Play for $1</h1>
      <p class="mt-2">Humans only. Winners split the pot by equity. ${NETWORK === "testnet" ? "<b>Test money on NEAR testnet.</b>" : ""}</p>
      <div data-c=body class="mt-6 space-y-4"></div>
      <p data-c=msg class="mt-4 font-bold" role="status"></p>
    </div>
  </div>`;
  const body = root.querySelector<HTMLElement>("[data-c=body]")!;
  const msg = root.querySelector<HTMLElement>("[data-c=msg]")!;
  const say = (t: string): void => void (msg.textContent = t);
  let acc: string | null = null;

  const draw = async (): Promise<void> => {
    if (!acc) {
      body.innerHTML = `<article class="sticker rounded-box bg-paper p-5">
        <h2 class="font-display text-3xl">Sign in to play for money</h2>
        <p class="mt-1">Your winnings go to your own NEAR account. Practice stays free with no sign-in.</p>
        <div class="mt-4 flex flex-wrap gap-3"><button data-c=signin class="${btn} bg-liq text-paper">Sign in</button>
        <a href="#/play" class="${btn} bg-paper">Practice free</a></div></article>`;
      body.querySelector("[data-c=signin]")!.addEventListener("click", () => signIn().catch((e: Error) => say(e.message)));
      return;
    }
    const [bal, inWallet] = await Promise.all([balanceOf(acc), walletUsdc(acc).catch(() => 0n)]);
    body.innerHTML = `<article class="sticker rounded-box bg-paper p-5">
        <div class="flex items-baseline justify-between gap-3"><span class="tag truncate">${esc(acc)}</span>
          <button data-c=out class="tag underline">Sign out</button></div>
        <div class="mt-2 font-display text-5xl"><span class="tabular-nums">$${usd(bal)}</span> <span class="text-2xl">balance</span></div>
        <div class="mt-4 flex flex-wrap gap-3">
          <button data-c=play class="${btn} bg-liq text-paper">PLAY $1</button>
          <button data-c=add class="${btn} bg-paper">Add funds</button>
        </div></article>
      ${NETWORK === "testnet" ? `<article class="sticker rounded-box bg-paper p-5">
        <h2 class="font-display text-2xl">Test money</h2>
        <p>In your wallet: <span class="num">$${usd(inWallet)}</span>. Get 10 test USDC, then move $1 into your balance.</p>
        <div class="mt-3 flex flex-wrap gap-3"><button data-c=faucet class="${btn} bg-paper">Get test USDC</button>
        <button data-c=dep class="${btn} bg-paper" ${inWallet < 1_000_000n ? "disabled" : ""}>Move $1 in</button></div></article>` : ""}
      <div data-c=funds></div>`;
    const on = (k: string, f: (b: HTMLButtonElement) => Promise<void>): void => {
      const b = body.querySelector<HTMLButtonElement>(`[data-c=${k}]`);
      b?.addEventListener("click", () => {
        b.disabled = true;
        say("");
        f(b).catch((e: Error) => say(e.message)).finally(() => (b.disabled = false));
      });
    };
    body.querySelector("[data-c=out]")!.addEventListener("click", () => void signOut());
    on("play", async (b) => {
      try {
        const entry = await payToPlay(acc!, (s) => (b.textContent = STEP[s]));
        if (entry.ticketTx) say(`Ticket bought. ${EXPLORER}/txns/${entry.ticketTx}`);
        setPaidSeat({ mode: "paid", accountId: acc!, ticketId: entry.ticketTx ?? "held" });
        location.hash = "#/play";
      } catch (e) {
        b.textContent = "PLAY $1";
        if (e instanceof NeedFunds) {
          say(`You have $${usd(e.balance)}. A match needs $1.00. Add funds first.`);
          await addFunds(body.querySelector<HTMLElement>("[data-c=funds]")!, acc!, say);
        } else throw e;
      }
    });
    on("add", () => addFunds(body.querySelector<HTMLElement>("[data-c=funds]")!, acc!, say));
    on("faucet", async () => {
      await testnetFaucet(acc!);
      await draw();
    });
    on("dep", async () => {
      await deposit(acc!, 1_000_000n);
      await draw();
    });
  };

  // Dev only: ?as=<account> previews the signed-in view (reads only, any tx still needs the wallet).
  const as = import.meta.env.DEV ? new URLSearchParams(location.search).get("as") : null;
  const off = onAccount((a) => {
    acc = a ?? as;
    void draw().catch((e: Error) => say(`Could not read your balance: ${e.message}`));
  });
  return off;
};

/** Add funds from any chain: token, amount, refund address, then a dry quote with the guaranteed minimum. */
async function addFunds(box: HTMLElement, acc: string, say: (t: string) => void): Promise<void> {
  box.innerHTML = `<article class="sticker rounded-box bg-paper p-5"><p class="tag">Loading tokens</p></article>`;
  let tokens: OriginToken[];
  try {
    tokens = (await originTokens()).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
  } catch (e) {
    box.innerHTML = "";
    return say((e as Error).message);
  }
  const field = "mt-1 w-full rounded-field border-4 border-ink bg-paper px-3 py-2";
  box.innerHTML = `<form class="sticker space-y-3 rounded-box bg-paper p-5">
    <h2 class="font-display text-3xl">Add funds</h2>
    <p>Pay from any chain. It arrives as USDC in your MARGIN balance.</p>
    <label class="block">Pay with<select name=t class="${field}">${tokens
      .map((t, i) => `<option value=${i} ${t.symbol === "USDC" && t.blockchain === "base" ? "selected" : ""}>${esc(t.symbol)} on ${esc(t.blockchain)}</option>`)
      .join("")}</select></label>
    <label class="block">Amount<input name=a inputmode=decimal value="2" class="${field} num" /></label>
    <label class="block">Refund address on that chain<input name=r required placeholder="if the swap fails, funds go back here" class="${field} num" /></label>
    <button class="${btn} bg-liq text-paper">Get quote</button>
    <div data-q></div></form>`;
  const form = box.querySelector("form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = form.querySelector<HTMLElement>("[data-q]")!;
    const fd = new FormData(form);
    const t = tokens[Number(fd.get("t"))]!;
    const amt = Number(fd.get("a"));
    if (!(amt > 0)) return say("Enter an amount above 0.");
    q.innerHTML = `<p class="tag">Asking the market</p>`;
    const base = BigInt(Math.round(amt * 10 ** Math.min(t.decimals, 9))) * 10n ** BigInt(Math.max(0, t.decimals - 9));
    const r = await quoteDeposit(acc, t.assetId, base.toString(), String(fd.get("r")).trim());
    if (!r.ok) return void (q.innerHTML = `<p class="font-bold">${esc(r.reason)}</p>`);
    const min = usd(BigInt(r.quote.minAmountOut));
    q.innerHTML = `<div class="rounded-field bg-ink p-4 text-paper">
      <div>You send <span class="num">${esc(r.quote.amountInFormatted)} ${esc(t.symbol)}</span></div>
      <div class="font-display text-3xl text-gold">+$<span class="tabular-nums">${esc(Number(r.quote.amountOutFormatted).toFixed(2))}</span></div>
      <div class="text-sm">At least <span class="num">$${min}</span>, about <span class="num">${r.quote.timeEstimate}</span> s</div>
      ${r.dry || !r.quote.depositAddress
        ? `<p class="tag mt-2 text-muted">Preview price. Deposits open when mainnet goes live.</p>`
        : `<p class="mt-2">Send exactly that amount to</p><p class="num break-all font-bold">${esc(r.quote.depositAddress)}</p>`}
    </div>`;
  });
}
