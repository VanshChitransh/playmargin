// End-of-life overlays over the arena: the LIQUIDATED screen the moment I pop (readable,
// fair death: who, how greedy, how long red) and the money receipt at the bell. One
// primary button each (Play again); Watch keeps spectating, so the room stays alive.
import type { Outcome } from "../game/receipt";

const fmt = (n: number): string => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(Math.abs(n) < 10 ? 2 : 0);
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(root: HTMLElement, inner: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "fixed inset-0 z-20 grid place-items-center bg-ink/85 p-4";
  el.innerHTML = inner;
  root.appendChild(el);
  return el;
}

const btn = (act: string, text: string, primary: boolean): string =>
  `<button data-act="${act}" class="sticker sticker-press rounded-box px-5 py-3 font-display text-xl ${primary ? "bg-paper text-ink" : "bg-navy text-paper"}">${text}</button>`;

// On the dark death screen an ink shadow vanishes, so the hard shadow turns liq red.
const onDark = (html: string): string => html.replace("<button", '<button style="box-shadow:6px 6px 0 var(--color-liq);border-color:var(--color-paper)"');

/** The pop moment. Returns the element so the caller can remove it when Watch is pressed. */
export function showDeath(root: HTMLElement, d: NonNullable<Outcome["death"]>, act: (a: "watch" | "again") => void): HTMLElement {
  const why = d.keeper ? "VAULT CLOSED YOUR LOAN" : `popped by ${esc(d.by)}`;
  const greed =
    d.leverage >= 1.05
      ? `You were <b class="num">${d.leverage.toFixed(1)}x</b>, red for <b class="num">${Math.max(0, d.redS).toFixed(0)} s</b>.`
      : "No loan, just outsized.";
  const el = shell(
    root,
    `<div class="text-center">
      <div class="stamp inline-block rounded-box border-[6px] border-liq px-6 py-2 font-display text-6xl text-liq sm:text-7xl">LIQUIDATED</div>
      <p class="tag mt-6 text-paper">${why}</p>
      <p class="mt-2 text-lg text-paper">${greed}</p>
      <p class="mt-1 text-sm text-muted">Tap REPAY earlier, or run before you go red.</p>
      <div class="mt-6 flex justify-center gap-4">${onDark(btn("again", "Play again", true))}${onDark(btn("watch", "Watch", false))}</div>
    </div>`,
  );
  wire(el, act);
  return el;
}

/** The bell: a receipt whose lines add up to the final number. */
export function showResults(root: HTMLElement, o: Outcome, act: (a: "again" | "home" | "verify") => void): HTMLElement {
  const title = o.kind === "cashed" ? "CASHED OUT" : o.kind === "survived" ? "SURVIVED" : "LIQUIDATED";
  const rows = o.lines
    .map((l) => `<div class="flex justify-between gap-6"><span>${esc(l.label)}</span><span class="num ${l.amount < 0 ? "text-liq" : ""}">${fmt(l.amount)}</span></div>`)
    .join("");
  const el = shell(
    root,
    `<div class="sticker w-full max-w-sm rounded-box bg-paper p-5 text-ink">
      <div class="flex items-start justify-between">
        <h2 class="font-display text-4xl">${title}</h2>
        <span class="tag rounded-field bg-ink px-2 py-1 text-paper">#${o.rank}/${o.of}</span>
      </div>
      <div class="mt-4 space-y-1 border-y-2 border-dashed border-ink/40 py-3 font-mono text-sm">
        <div class="flex justify-between"><span>Start</span><span class="num">${o.start.toFixed(2)}</span></div>
        ${rows}
      </div>
      <div class="mt-3 flex items-baseline justify-between">
        <span class="tag">You keep</span>
        <span class="num font-display text-5xl ${o.end > o.start ? "" : "text-liq"}">${o.end.toFixed(2)}</span>
      </div>
      <p class="mt-1 text-xs text-ink/60">Practice credits. Never cash, never bought.</p>
      <div class="mt-5 flex flex-wrap gap-3">${btn("again", "Play again", true).replace("bg-paper", "bg-liq")}${btn("verify", "Verify", false)}${btn("home", "Home", false)}</div>
    </div>`,
  );
  wire(el, act);
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
