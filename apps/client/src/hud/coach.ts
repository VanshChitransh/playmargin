// First-match coach marks for a brand-new guest. Warm-up already teaches with the centre hints,
// so the coach waits for GO and shows ONE bubble at a time above its button: first BOOST, then
// (once the player has boosted, or after 10 s) REPAY, then it is done for good. Stored per
// browser with try/catch: in a private window it may show again, which is harmless.
import type { Phase } from "@margin/core";

const KEY = "margin.coached";
const BUBBLE_S = 6;

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
  update(phase: Phase, elapsedS: number, boosted: boolean, danger: boolean): void;
  close(): void;
}

/** target(step) = the button the bubble points at; the bubble sits above that button's dock. */
export function coachMarks(root: HTMLElement, target: (s: "boost" | "repay") => HTMLElement): Coach {
  if (seen()) return { update: () => {}, close: () => {} };
  const el = document.createElement("div");
  el.className = "pointer-events-none fixed inset-0 z-10 hidden";
  root.appendChild(el);
  let step: "" | "boost" | "repay" = "";
  let shownAt = 0;
  let lastE = 0;
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
      ? `<b>Hold SPACE: BOOST</b>. Grow fast, on a loan.`
      : `<b>Hold R: REPAY</b> pays it back.`;
    // Measured from the real layout: the bubble floats above the whole dock (never over a
    // control) and its tail sits over the button it names.
    const btn = target(s).getBoundingClientRect();
    const dock = (target(s).parentElement ?? target(s)).getBoundingClientRect();
    const right = Math.max(8, innerWidth - (btn.left + btn.width / 2) - 28);
    const pos = `bottom:${Math.round(innerHeight - dock.top + 16)}px;right:${Math.round(right)}px`;
    shownAt = lastE;
    el.innerHTML = `<div class="pop absolute flex max-w-60 items-center gap-2 rounded-2xl bg-card px-3 py-2 text-sm text-ink" style="${pos}">
      <span>${text}</span>
      <i class="absolute -bottom-[11px] right-5 size-4 rotate-45 border-r-4 border-b-4 border-grid bg-card"></i>
      <button data-got class="pop-sm pop-press pointer-events-auto shrink-0 cursor-pointer rounded-lg bg-warn px-2 py-1 font-display text-sm">OK</button></div>`;
    el.querySelector("[data-got]")!.addEventListener("click", () => (boost ? show("repay") : close()));
    el.classList.remove("hidden");
  };

  return {
    update(phase, e, boosted, danger) {
      if (done) return;
      lastE = e;
      // In danger the screen belongs to the margin call: never cover it with a tip.
      if (phase === "ENDED" || danger) return close();
      if (phase !== "LIVE") return;
      if (step === "") show("boost");
      else if (step === "boost" && (boosted || e - shownAt >= BUBBLE_S)) show("repay");
      else if (step === "repay" && e - shownAt >= BUBBLE_S) close();
    },
    close,
  };
}
