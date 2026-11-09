// First-match coach marks for a brand-new guest. Warm-up already teaches with the centre hints,
// so the coach waits for GO and shows ONE bubble at a time next to its button: first BOOST, then
// (once the player has boosted, or after 10 s) REPAY, then it is done for good. Stored per
// browser with try/catch: in a private window it may show again, which is harmless.
import type { Phase } from "@margin/core";

const KEY = "margin.coached";
const BOOST_UNTIL_S = 10;
const DONE_AT_S = 22;

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode: the coach may show again next time */
  }
}

export interface Coach {
  /** Call every frame: elapsed match seconds and whether I have borrowed yet. */
  update(phase: Phase, elapsedS: number, boosted: boolean): void;
  close(): void;
}

export function coachMarks(root: HTMLElement, touch: boolean): Coach {
  if (seen()) return { update: () => {}, close: () => {} };
  const el = document.createElement("div");
  el.className = "pointer-events-none fixed inset-0 z-10 hidden";
  root.appendChild(el);
  let step: "" | "boost" | "repay" = "";
  let done = false;

  const close = (): void => {
    if (done) return;
    done = true;
    markSeen();
    el.remove();
  };
  const show = (s: "boost" | "repay"): void => {
    step = s;
    const boost = s === "boost";
    const text = boost
      ? `<b>${touch ? "Hold" : "Hold SPACE or"} BOOST</b> to grow and speed up. It is a loan.`
      : `<b>${touch ? "Tap" : "Press R or tap"} REPAY</b> to pay it back. The only way out of red.`;
    // Each bubble sits just left of its own button (BOOST bottom-right, REPAY above it).
    const pos = boost ? "bottom:max(28px,calc(env(safe-area-inset-bottom) + 28px));right:122px" : "bottom:120px;right:98px";
    el.innerHTML = `<div class="sticker absolute flex max-w-64 items-center gap-2 rounded-box bg-paper px-3 py-2 text-sm text-ink" style="${pos}">
      <span>${text}</span><b class="font-display text-lg text-liq">→</b>
      <button data-got class="pointer-events-auto tag shrink-0 rounded-field border-2 border-ink px-2 py-0.5 text-[11px]">OK</button></div>`;
    el.querySelector("[data-got]")!.addEventListener("click", () => (boost ? show("repay") : close()));
    el.classList.remove("hidden");
  };

  return {
    update(phase, e, boosted) {
      if (done) return;
      if (phase === "ENDED" || (phase === "LIVE" && e >= DONE_AT_S)) return close();
      if (phase !== "LIVE") return;
      if (step === "" ) show("boost");
      else if (step === "boost" && (boosted || e >= BOOST_UNTIL_S)) show("repay");
    },
    close,
  };
}
