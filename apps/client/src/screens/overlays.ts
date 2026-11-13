// End-of-life overlays over the arena: the LIQUIDATED screen the moment I pop (readable,
// fair death: who, how greedy, how long red) and the money receipt at the bell, laid out as
// the v8 Cover Story mockup (research/margin/ui/variants). One primary button each (Play
// again); Watch keeps spectating, so the room stays alive.
import { R } from "@margin/core";
import { centLines, type Outcome } from "../game/receipt";
import { showStake } from "../stake";
import { NETWORK } from "../chain/config";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Arcade Paper tokens (REVAMP-PLAN 1). The new ones carry their value as a fallback so the
// screens read right before and after style.css defines them.
const COBALT = "var(--color-cobalt,#2D4BF0)";
const CREAM = "var(--color-cream,#FFEFD3)";
const CARD = "var(--color-card,#FFFFFF)";
const TAPE = "var(--color-tape,rgba(255,226,140,.82))";

function shell(root: HTMLElement, inner: string, cls: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `fixed inset-0 z-20 overflow-y-auto text-ink ${cls}`;
  el.innerHTML = inner;
  root.appendChild(el);
  return el;
}

// Every action is a filled sticker button (never an underlined link): fill, text, size.
const btn = (act: string, text: string, fill: string, size = "h-14 px-4 text-xl sm:h-16 sm:px-6 sm:text-2xl"): string =>
  `<button data-act="${act}" class="sticker sticker-press flex items-center justify-center gap-3 whitespace-nowrap rounded-box font-display text-ink ${size}" style="background:${fill}${fill.includes("cobalt") ? ";color:#fff" : ""}">${text}</button>`;
const tape = (pos: string): string => `<span aria-hidden="true" class="pointer-events-none absolute h-7 w-24" style="background:${TAPE};${pos}"></span>`;

// Results buttons read like the v8 tickets: label left, icon right.
const BIG = "h-[72px] w-full !justify-between px-6 text-2xl";
const icon = (d: string): string =>
  `<svg viewBox="0 0 24 24" class="h-7 w-7 shrink-0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const chip = (act: string, text: string): string =>
  `<button data-act="${act}" class="sticker-press rounded-field border-[3px] border-ink bg-white px-4 py-2.5 font-sans text-base font-bold text-ink" style="box-shadow:3px 3px 0 var(--color-ink)">${text}</button>`;

/** The pop moment. Returns the element so the caller can remove it when Watch is pressed. */
export function showDeath(root: HTMLElement, d: NonNullable<Outcome["death"]>, act: (a: "watch" | "again" | "share" | "receipt") => void): HTMLElement {
  const why = d.eaten ? `eaten by ${esc(d.by)}` : d.keeper ? "VAULT CLOSED YOUR LOAN" : `popped by ${esc(d.by)}`;
  // The unit sits outside the mono span: a mono space reads as a double space next to the number.
  const redS = Math.max(1, Math.round(d.redS));
  const greed =
    d.leverage >= 1.05
      ? `You were <b class="num">${d.leverage.toFixed(1)}x</b>${d.redS >= 0.5 ? `, red for <b class="num">${redS}</b> second${redS === 1 ? "" : "s"}` : ""}.${
          // BOOST stops at 2.5x, but spikes and the zone shrink what you own while the loan stays (QA-E-11).
          d.leverage > R.LEVERAGE_CAP + 0.05 ? ` BOOST stops at ${R.LEVERAGE_CAP}x: losses on a loan pushed you past it.` : ""
        }`
      : "No loan, just outsized.";
  const el = shell(
    root,
    `<div class="grid min-h-full place-items-center p-4">
      <div class="sticker relative w-full max-w-md rounded-box p-6 pt-8 text-center sm:p-8" style="background:${CARD}">
        ${tape("left:-18px;top:-6px;transform:rotate(-32deg)")}${tape("right:-18px;top:-6px;transform:rotate(32deg)")}
        <div class="stamp inline-block rounded-box border-[6px] border-liq bg-white px-5 py-1 font-display text-5xl text-liq sm:text-6xl">${d.eaten ? "EATEN" : "LIQUIDATED"}</div>
        <p class="mt-6"><span class="tag inline-block rounded-field bg-ink px-3 py-2 text-paper">${why}</span></p>
        <p class="mt-4 text-lg font-semibold">${greed}</p>
        <p class="mt-1 text-sm text-muted">${d.eaten ? "A blob 15% bigger eats you on touch. Run, or grow first." : "Hold REPAY earlier, or run before you go red."}</p>
        <div class="mt-6 grid grid-cols-2 gap-4">${btn("again", "Play again", "var(--color-cobalt)")}${btn("watch", "Watch", CARD)}</div>
        <div class="mt-4">${btn("receipt", "See receipt", CARD, "h-14 w-full px-4 text-lg")}</div>
        ${d.eaten ? "" : `<div class="mt-4">${btn("share", "Get your Liquidation Certificate", "var(--color-warn)", "h-14 w-full px-4 text-lg")}</div>`}
      </div>
    </div>`,
    "bg-ink/70",
  );
  wire(el, act);
  return el;
}

/** The bell: a receipt whose lines add up to the final number (v8 Cover Story layout). */
export function showResults(root: HTMLElement, o: Outcome, act: (a: "again" | "home" | "verify" | "share") => void, paid = false, stakeUsd = 1): HTMLElement {
  // Paid rooms show dollars: one entry is 100 game units and costs the stake (P03).
  const k = paid ? stakeUsd / R.UNITS_PER_USDC : 1;
  const cur = paid ? "$" : "";
  // Stacked like the v8 poster (SUR / VIVED.): two short lines, giant, ink shadow. A death gets
  // the same weight with a red shadow, so it never needs a rotated stamp over the text below.
  const title =
    o.kind === "cashed" ? "CASHED<br>OUT." : o.kind === "survived" ? "SUR<br>VIVED." : o.death?.eaten ? "EATEN." : "LIQUI<br>DATED.";
  const dead = o.kind === "popped";
  const s = o.stats;
  const why =
    o.kind === "cashed"
      ? "You cashed out before the vault came for you."
      : o.kind === "survived"
        ? "Still standing at the bell."
        : o.death?.eaten
          ? `Eaten by ${esc(o.death.by)}.`
          : o.death?.keeper
            ? "The vault closed your loan."
            : `Popped by ${esc(o.death?.by ?? "the vault")}.`;
  // The tile shows the receipt's own food line, so the stat and the receipt can't disagree (QA-B-11).
  const food = o.lines.find((l) => l.label.startsWith("Food"))?.amount ?? 0;
  const foodNet = `${food >= 0 ? "+" : "\u2212"}${cur}${Math.abs(food * k).toFixed(paid ? 2 : 1)}`;
  const judge = location.pathname === "/judge"; // the Judge Run route (index.ts), QA-B-12
  const alive = `${Math.floor(s.aliveS / 60)}:${String(s.aliveS % 60).padStart(2, "0")}`;
  const cell = (label: string, value: string, span: string, cls = ""): string =>
    `<div class="${span} px-3 py-3 sm:px-4" style="background:${CARD}"><div class="font-display text-3xl leading-none tabular-nums sm:text-4xl ${cls}">${value}</div><div class="mt-1.5 text-sm font-semibold text-muted">${label}</div></div>`;
  // Five cells: 3 + 2 on phones (col spans of a 6 grid), one row from sm up. The ink gap is the rule.
  const stats = `<div class="sticker grid grid-cols-6 gap-[3px] bg-ink sm:grid-cols-5">
      ${cell("food minus zone", foodNet, "col-span-2 sm:col-span-1")}
      ${cell("time alive", alive, "col-span-2 sm:col-span-1")}
      ${cell("blobs eaten", String(s.blobsEaten), "col-span-2 sm:col-span-1")}
      ${cell(dead ? "best while alive" : "top rank", `#${s.topRank}`, "col-span-3 sm:col-span-1")}
      ${cell("peak equity", paid ? `$${(s.peakEquity * k).toFixed(2)}` : s.peakEquity.toFixed(0), "col-span-3 sm:col-span-1", "text-[#B97A0F]")}
    </div>`;
  const line = (label: string, v: string, neg = false): string =>
    `<div class="flex justify-between gap-6 border-b border-dashed border-ink/25 py-2"><span>${label}</span><span class="num ${neg ? "text-liq" : ""}">${v}</span></div>`;
  // Whole cents that add up to YOU KEEP on screen (QA-E-16): rounding each line alone could miss by a cent or two.
  const cents = centLines(o.start * k, o.lines.map((l) => l.amount * k), o.end * k);
  const money = (c: number): string => cur + (Math.abs(c) / 100).toFixed(2);
  const rows = o.lines.map((l, i) => line(esc(l.label), (cents[i]! >= 0 ? "+" : "\u2212") + money(cents[i]!), cents[i]! < 0)).join("");
  // Every cent of the entry: the part seeded into the arena food is the difference, so the two
  // lines always meet the start exactly.
  const startC = Math.round(o.start * k * 100);
  const entryC = Math.round((o.start / R.START_MASS_RATIO) * k * 100);
  const entry = line("Entry", money(entryC)) + line("Seeded into the arena food", "\u2212" + money(entryC - startC), true);
  const el = shell(
    root,
    `<div class="flex min-h-full flex-col lg:flex-row" style="background:color-mix(in srgb, var(--color-paper) 88%, transparent)">
      <section class="relative flex flex-col px-5 pb-10 pt-7 text-white sm:px-10 lg:w-[540px] lg:shrink-0 lg:pr-20 lg:pt-14 lg:[clip-path:polygon(0_0,100%_0,90%_100%,0_100%)]" style="background:radial-gradient(circle at 2px 2px, rgba(255,255,255,.13) 2px, transparent 0) 0 0/22px 22px, ${COBALT}">
        <p class="tag flex items-center gap-3 text-warn"><span class="h-[3px] w-8 bg-warn"></span>${paid ? `<span data-stake>$1</span> match` : judge ? "Judge Run" : "Practice match"} &middot; ${o.of} played</p>
        <h2 class="mt-4 font-display text-[84px] leading-[.86] sm:text-[100px]" style="text-shadow:6px 6px 0 ${dead ? "var(--color-liq)" : "var(--color-ink)"}">${title}</h2>
        <p class="mt-5 max-w-sm text-xl text-white/90">${why}</p>
        ${s.clutches ? `<p class="mt-3"><span class="tag inline-block rounded-field bg-ink px-3 py-2 text-paper">\u2713 ${s.clutches} clutch save${s.clutches > 1 ? "s" : ""}</span></p>` : ""}
        <div class="mt-6 flex items-end gap-3">
          <b class="font-display text-[120px] leading-[.8] text-warn sm:text-[148px]" style="text-shadow:7px 7px 0 var(--color-ink)">${dead ? "OUT" : `#${o.rank}`}</b>
          <span class="pb-1 font-display text-4xl">${dead ? `after ${alive}` : `/${o.of}`}<small class="tag block text-warn">${dead ? "no rank when popped" : "final rank"}</small></span>
        </div>
        <div class="mt-10 grid max-w-[360px] gap-4">
          ${btn("again", `Play again${icon("M3 12a9 9 0 1 0 3-6.7M3 4v5h5")}`, "var(--color-safe)", BIG)}
          ${btn("share", `${o.death && !o.death.eaten ? "Get your Certificate" : "share" in navigator ? "Share" : "Post on X"}${icon("M7 17 17 7M8 7h9v9")}`, CARD, BIG)}
        </div>
        <div class="mt-6 flex gap-3">${chip("verify", "Verify this match")}${chip("home", "Home")}</div>
        <div data-social class="mt-6 max-w-[360px] rounded-box bg-card p-3 text-ink empty:hidden"></div>
      </section>
      <section class="relative z-10 flex-1 px-4 py-8 sm:px-10 lg:py-12 lg:pl-6"><!-- above the cat: YOU KEEP is never hidden (QA-E-07) -->
        ${stats}
        <div class="sticker relative mx-auto mt-10 max-w-xl px-5 pb-5 pt-6 sm:px-7 lg:rotate-[-1deg]" style="background:${CREAM}">
          ${tape("left:-22px;top:-8px;transform:rotate(-30deg)")}${tape("right:-22px;top:-8px;transform:rotate(30deg)")}
          <h3 class="flex items-baseline justify-between border-b-[3px] border-ink pb-3 font-display text-2xl">RECEIPT <span class="tag text-muted">where your ${money(entryC)} went</span></h3>
          <div class="font-mono text-sm sm:text-base">${entry}${rows}</div>
          <div class="sticker mt-4 flex items-center justify-between bg-gold px-4 py-3" style="box-shadow:none">
            <span class="font-display text-2xl">YOU KEEP</span>
            <span class="font-display text-5xl tabular-nums">${money(Math.round(o.end * k * 100))}</span>
          </div>
          <p class="mt-3 text-sm font-semibold text-muted">${paid ? (NETWORK === "testnet" ? "Test dollars (NEAR testnet), paid to your balance when the match settles." : "Real dollars, paid to your balance when the match settles.") : "Practice credits. Never cash, never bought."}</p>
        </div>
      </section>
      <img src="/brand/margin-cat-cutout.svg" alt="" aria-hidden="true" class="pointer-events-none fixed bottom-6 right-10 z-0 hidden w-36 rotate-[8deg] lg:block" />
    </div>`,
    "backdrop-blur-sm arcade",
  );
  wire(el, act);
  if (paid) void showStake(el);
  (el.querySelector("[data-act=again]") as HTMLElement).focus();
  return el;
}

function wire<A extends string>(el: HTMLElement, act: (a: A) => void): void {
  el.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.dataset.act as A)));
}

/** Paid match cancelled before GO: nothing was spent, say so in game words, then go home. */
export function showAborted(root: HTMLElement, reason: string, home: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "fixed inset-0 z-20 grid place-items-center bg-ink/80 p-4";
  el.innerHTML = `<div class="sticker max-w-sm rounded-box bg-paper p-6 text-center text-ink">
    <h2 class="font-display text-4xl">Match cancelled</h2>
    <p class="mt-2 text-lg">Your $1 is back in your balance.</p>
    <p data-r class="mt-3 text-xs text-muted"></p>
    <button class="sticker sticker-press mt-5 rounded-box bg-liq px-6 py-3 font-display text-xl text-paper">Back home</button></div>`;
  el.querySelector("[data-r]")!.textContent = reason;
  el.querySelector("button")!.addEventListener("click", home);
  setTimeout(home, 8000);
  root.appendChild(el);
  return el;
}
