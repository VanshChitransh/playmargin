// /cash: the $1 match. Sign in, see your balance, PLAY $1 (S4 payToPlay: quick-play key, ticket,
// then a paid seat), or Add funds from any chain through 1-Click dry quotes. Chain words stay out:
// the player sees "balance", "ticket" and "Add funds", never keys or transactions.
import { NETWORK } from "../chain/config";
import { STATE_WORDS, depositStatus, originTokens, quoteDeposit, type OriginToken } from "../chain/addfunds";
import { balanceOf, deposit, testnetFaucet, walletUsdc, withdraw } from "../chain/funds";
import { showStake } from "../stake";
import { NeedFunds, payToPlay, type PaidStep } from "../chain/paid";
import { EMAIL_LOGIN, createEmailAccount, onAccount, resumeEmail, signIn, signInEmail, signOut } from "../chain/wallet";
import { setPaidSeat } from "../play";
import type { Screen } from "../router";
import { navigate } from "../router";
import type { JoinOpts } from "@margin/core";
import { BTN, footerSlot, header, mountSiteFooter } from "./chrome";

const STEP: Record<PaidStep, string> = { "quick-play": "Turning on quick play", ticket: "Buying ticket", ready: "Joining" };
const usd = (base: bigint): string => (Number(base) / 1e6).toFixed(2);
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Tone = "info" | "ok" | "error";
/** One status line for the whole screen: what just happened, in game words. */
type Say = (text: string, tone?: Tone) => void;
const TONE: Record<Tone, [string, string]> = {
  info: ["bg-card text-ink", "\u00b7"],
  ok: ["bg-card text-ink", "\u2713"],
  error: ["bg-liq text-paper", "!"],
};

export const cash: Screen = (root) => {
  let stake = "$1"; // replaced by the contract's real entry stake as soon as it is read
  root.innerHTML = `
  <div class="min-h-full bg-paper text-ink">
    ${header()}
    <main class="mx-auto max-w-xl px-4 pb-24 pt-10">
      <span class="sticker inline-block rounded-field bg-gold px-3 py-1 text-sm font-bold">${NETWORK === "testnet" ? "Test money" : "Real money"}</span>
      <h1 class="mt-3 font-display text-6xl">Paid test match</h1>
      <p class="mt-2 text-muted">Humans only. Winners split the pot by equity. ${NETWORK === "testnet" ? "<b>Test USDC on NEAR testnet, nothing real at stake.</b>" : ""}</p>
      <div data-c=body class="mt-6 space-y-4"></div>
      <div data-c=msg class="mt-4" role="status" aria-live="polite"></div>
    </main>
    ${footerSlot}
  </div>`;
  const stopFooter = mountSiteFooter(root);
  void showStake(root).then((l) => (stake = l)); // later renders read stake, this fills what is already drawn
  const body = root.querySelector<HTMLElement>("[data-c=body]")!;
  const msg = root.querySelector<HTMLElement>("[data-c=msg]")!;
  const say: Say = (t, tone = "info") => {
    if (!t) return void (msg.innerHTML = "");
    const [cls, icon] = TONE[tone];
    msg.innerHTML = `<p class="sticker flex items-start gap-3 rounded-box px-4 py-3 font-medium ${cls}"><b class="font-display text-xl leading-none">${icon}</b><span>${esc(t)}</span></p>`;
  };
  let acc: string | null = null;

  let needsName = false;

  const draw = async (): Promise<void> => {
    if (!acc && needsName) {
      body.innerHTML = `<form class="sticker rounded-box bg-card p-5">
        <h2 class="font-display text-3xl">Pick your name</h2>
        <p class="mt-1">It is your account name and shows on the leaderboard. Lowercase letters, numbers, - and _.</p>
        <input name=n required minlength=2 maxlength=40 pattern="[a-z0-9_\\-]+" autocomplete=off class="mt-3 w-full rounded-field border border-grid bg-cream px-3 py-2 num" />
        <button class="${BTN.go} mt-3">Create my account</button></form>`;
      const f = body.querySelector("form")!;
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        const b = f.querySelector("button")!;
        b.disabled = true;
        say("");
        createEmailAccount(String(new FormData(f).get("n")))
          .then(() => (needsName = false))
          .catch((err: Error) => say(err.message, "error"))
          .finally(() => (b.disabled = false));
      });
      return;
    }
    if (!acc) {
      body.innerHTML = `<article class="sticker rounded-box bg-card p-5">
        <h2 class="font-display text-3xl">Sign in to play for money</h2>
        <p class="mt-1">Winnings land in your own account, not ours. Practice stays free with no sign-in.</p>
        ${NETWORK === "testnet" ? `<p class="mt-2 text-sm text-muted">Paid play runs on NEAR testnet: sign in with a testnet account in <a class="link" href="https://wallet.meteorwallet.app" target="_blank" rel="noopener">Meteor</a> or <a class="link" href="https://wallet.intear.tech" target="_blank" rel="noopener">Intear</a>.</p>` : ""}
        <div class="mt-4 flex flex-wrap gap-3">${EMAIL_LOGIN ? `<button data-c=email class="${BTN.go}">Log in with email</button>` : ""}
        <button data-c=signin class="${EMAIL_LOGIN ? BTN.card : BTN.go}">${EMAIL_LOGIN ? "Other sign-in options" : "Sign in"}</button>
        <a href="/play" class="${BTN.card}">Practice free</a></div></article>`;
      body.querySelector("[data-c=signin]")!.addEventListener("click", () => signIn().catch((e: Error) => say(e.message, "error")));
      body.querySelector("[data-c=email]")?.addEventListener("click", () => signInEmail().catch((e: Error) => say(e.message, "error")));
      return;
    }
    if (!body.querySelector("[data-c=play]")) body.innerHTML = `<article class="sticker animate-pulse rounded-box bg-card p-5"><p class="tag">Loading your balance</p><div class="mt-3 h-12 w-40 rounded-field bg-ink/10"></div></article>`;
    const [bal, inWallet] = await Promise.all([balanceOf(acc), walletUsdc(acc).catch(() => 0n)]);
    body.innerHTML = `<article class="sticker rounded-box bg-card p-5">
        <div class="flex items-center justify-between gap-3"><span class="tag truncate">Profile: ${esc(acc)}</span>
          <button data-c=out class="${BTN.small} shrink-0 whitespace-nowrap">Sign out</button></div>
        <div class="mt-2 font-display text-5xl"><span class="tabular-nums text-[#B97A0F]">$${usd(bal)}</span> <span class="text-2xl">balance</span></div>
        <div class="mt-4 flex flex-wrap gap-3">
          <button data-c=play class="${BTN.go}">PLAY <span data-stake>${stake}</span></button>
          <button data-c=add class="${BTN.card}">Add funds</button>
          ${bal > 0n ? `<button data-c=wd class="${BTN.card}">Withdraw</button>` : ""}
        </div>
        <div data-c=wdbox></div></article>
      ${NETWORK === "testnet" ? `<article class="sticker rounded-box bg-cream p-5">
        <h2 class="font-display text-2xl">Test money</h2>
        <p>Test cash outside the game: <span class="num">$${usd(inWallet)}</span>. Get $10, then move $1 into your balance.</p>
        <div class="mt-3 flex flex-wrap gap-3"><button data-c=faucet class="${BTN.card}">Get test cash</button>
        <button data-c=dep class="${BTN.card}" ${inWallet < 1_000_000n ? "disabled" : ""}>Move $1 in</button></div></article>` : ""}
      <div data-c=funds></div>`;
    const on = (k: string, f: (b: HTMLButtonElement) => Promise<void>): void => {
      const b = body.querySelector<HTMLButtonElement>(`[data-c=${k}]`);
      b?.addEventListener("click", () => {
        b.disabled = true;
        say("");
        f(b).catch((e: Error) => say(e.message, "error")).finally(() => (b.disabled = false));
      });
    };
    body.querySelector("[data-c=out]")!.addEventListener("click", () => void signOut());
    on("play", async (b) => {
      try {
        const entry = await payToPlay(acc!, (s) => (b.textContent = STEP[s]));
        const accountId = acc!;
        // join = S4's NEP-413 proof, checked by S2's paid onAuth (not in core JoinOpts yet).
        setPaidSeat(() => ({ mode: "paid", accountId, ticketId: entry.ticketTx ?? "held", join: entry.join() }) as JoinOpts);
        navigate("/play");
      } catch (e) {
        b.innerHTML = `PLAY <span data-stake>${stake}</span>`;
        if (e instanceof NeedFunds) {
          say(`You have $${usd(e.balance)}. A match needs ${stake}. Add funds first.`, "error");
          await addFunds(body.querySelector<HTMLElement>("[data-c=funds]")!, acc!, say);
        } else throw e;
      }
    });
    on("add", () => addFunds(body.querySelector<HTMLElement>("[data-c=funds]")!, acc!, say));
    on("faucet", async (b) => {
      b.textContent = "Getting test cash";
      await testnetFaucet(acc!);
      say("Got $10 of test cash. Move $1 in to play.", "ok");
      await draw();
    });
    on("dep", async (b) => {
      b.textContent = "Moving $1";
      await deposit(acc!, 1_000_000n);
      say("$1 is in your balance. Ready to play.", "ok");
      await draw();
    });
    // Withdraw asks once, inline, with the exact amount: money never moves on a single stray tap.
    on("wd", async () => {
      const box = body.querySelector<HTMLElement>("[data-c=wdbox]")!;
      box.innerHTML = `<div class="mt-4 flex flex-wrap items-center gap-3 rounded-field border border-grid bg-cream p-3">
        <span>Withdraw <b class="tabular-nums">$${usd(bal)}</b> to your own account?</span>
        <button data-c=wdgo class="${BTN.ink} py-2 text-lg">Withdraw $${usd(bal)}</button>
        <button data-c=wdno class="${BTN.small}">Cancel</button></div>`;
      box.querySelector("[data-c=wdno]")!.addEventListener("click", () => void (box.innerHTML = ""));
      const go = box.querySelector<HTMLButtonElement>("[data-c=wdgo]")!;
      go.addEventListener("click", () => {
        go.disabled = true;
        go.textContent = "Withdrawing";
        withdraw(acc!, bal)
          .then(() => say(`Withdrawn: $${usd(bal)} is back in your own account.`, "ok"))
          .then(draw)
          .catch((e: Error) => {
            say(e.message, "error");
            go.disabled = false;
            go.textContent = `Withdraw $${usd(bal)}`;
          });
      });
    });
  };

  // Dev only: ?as=<account> previews the signed-in view (reads only, any tx still needs the wallet).
  const as = import.meta.env.DEV ? new URLSearchParams(location.search).get("as") : null;
  const off = onAccount((a) => {
    acc = a ?? as;
    void draw().catch((e: Error) => say(`Could not read your balance: ${e.message}`, "error"));
  });
  // Email players come back from Auth0 logged in: restore them, or ask a new one for a name.
  void resumeEmail()
    .then((r) => {
      if (r !== "needs-name") return;
      needsName = true;
      return draw();
    })
    .catch((e: Error) => say(`Email login: ${e.message}`, "error"));
  return () => {
    off();
    stopFooter();
  };
};

/** Add funds from any chain: token, amount, refund address, then a dry quote with the guaranteed minimum. */
async function addFunds(box: HTMLElement, acc: string, say: Say): Promise<void> {
  box.innerHTML = `<article class="sticker animate-pulse rounded-box bg-card p-5"><p class="tag">Loading the ways to pay</p></article>`;
  let tokens: OriginToken[];
  try {
    tokens = (await originTokens()).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
  } catch (e) {
    box.innerHTML = "";
    return say(`${(e as Error).message}. Try Add funds again in a minute.`, "error");
  }
  const field = "mt-1 w-full rounded-field border border-grid bg-cream px-3 py-2";
  box.innerHTML = `<form class="sticker space-y-3 rounded-box bg-card p-5">
    <div class="flex items-start justify-between"><h2 class="font-display text-3xl">Add funds</h2><button type=button data-close class="${BTN.small}">Close</button></div>
    <p>Pay from any chain. It arrives as dollars in your MARGIN balance.</p>
    <label class="block">Pay with<select name=t class="${field}">${tokens
      .map((t, i) => `<option value=${i} ${t.symbol === "USDC" && t.blockchain === "base" ? "selected" : ""}>${esc(t.symbol)} on ${esc(t.blockchain)}</option>`)
      .join("")}</select></label>
    <label class="block">Amount<input name=a inputmode=decimal value="2" class="${field} num" /></label>
    <label class="block">Refund address on that chain<input name=r required autocomplete=off spellcheck=false placeholder="0x... / your address there" class="${field} num" />
      <span class="text-xs text-muted">If the swap cannot complete, your money goes back here.</span></label>
    <button data-get class="${BTN.go}">Get quote</button>
    <div data-q></div></form>`;
  const form = box.querySelector("form")!;
  form.querySelector("[data-close]")!.addEventListener("click", () => void (box.innerHTML = ""));
  const get = form.querySelector<HTMLButtonElement>("[data-get]")!;
  let poll = 0;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInterval(poll);
    const q = form.querySelector<HTMLElement>("[data-q]")!;
    const fd = new FormData(form);
    const t = tokens[Number(fd.get("t"))]!;
    const amt = Number(fd.get("a"));
    if (!(amt > 0)) return void (q.innerHTML = `<p class="text-sm font-bold">Enter an amount above 0.</p>`);
    q.innerHTML = `<p class="tag animate-pulse">Asking the market for a price</p>`;
    get.disabled = true;
    get.textContent = "Getting quote";
    const base = BigInt(Math.round(amt * 10 ** Math.min(t.decimals, 9))) * 10n ** BigInt(Math.max(0, t.decimals - 9));
    const r = await quoteDeposit(acc, t.assetId, base.toString(), String(fd.get("r")).trim()).catch((err: Error) => ({ ok: false as const, reason: err.message }));
    get.disabled = false;
    get.textContent = "Get a new quote";
    if (!r.ok) {
      const badAddress = /refund/i.test(r.reason);
      q.innerHTML = `<div class="rounded-field border border-grid bg-cream p-4">
        <p class="font-display text-xl">${badAddress ? "Check the refund address" : "No price right now"}</p>
        <p class="text-sm">${badAddress ? `That does not look like a ${esc(t.blockchain)} address. Paste the address you would send from.` : /internal|50\d|unavailable|timeout/i.test(r.reason) ? "The price service did not answer." : esc(r.reason)}</p>
        ${badAddress ? "" : `<p class="mt-1 text-xs text-muted">Markets for some coins pause for a minute. Try again, or pick another coin.</p>`}</div>`;
      return;
    }
    const min = usd(BigInt(r.quote.minAmountOut));
    q.innerHTML = `<div class="rounded-field bg-ink p-4 text-paper">
      <div>You send <span class="num">${esc(r.quote.amountInFormatted)} ${esc(t.symbol)}</span></div>
      <div class="font-display text-3xl text-gold">+$<span class="tabular-nums">${esc(Number(r.quote.amountOutFormatted).toFixed(2))}</span></div>
      <div class="text-sm">At least <span class="num">$${min}</span>, about <span class="num">${Number(r.quote.timeEstimate) || "?"}</span> s</div>
      ${r.dry || !r.quote.depositAddress
        ? `<p class="tag mt-2 text-paper/70"><b class="text-gold">DRY RUN:</b> a real 1-Click quote, no money moves on testnet.</p>`
        : `<p class="mt-2">Send exactly that amount to</p><p class="num break-all font-bold">${esc(r.quote.depositAddress)}</p>
           <p data-st class="tag mt-2 animate-pulse text-gold">${STATE_WORDS.waiting}</p>`}
    </div>`;
    const addr = r.quote.depositAddress;
    if (r.dry || !addr) return;
    // Live deposit: follow it until it lands (or comes back), in plain words.
    poll = window.setInterval(async () => {
      const st = await depositStatus(addr);
      const el = q.querySelector<HTMLElement>("[data-st]");
      if (el) el.textContent = STATE_WORDS[st];
      if (st === "done" || st === "refunded" || st === "failed") {
        clearInterval(poll);
        el?.classList.remove("animate-pulse");
        say(STATE_WORDS[st], st === "done" ? "ok" : "error");
      }
    }, 5000);
  });
}
