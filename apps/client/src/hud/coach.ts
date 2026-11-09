// First-match coach marks for a brand-new guest. Warm-up already teaches with the centre hints,
// so the coach waits for GO and shows ONE bubble at a time next to its button: first BOOST, then
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

export function coachMarks(root: HTMLElement, touch: boolean): Coach {
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
      ? `<b>${touch ? "Hold" : "Hold SPACE:"} BOOST</b>. Grow fast, on a loan.`
      : `<b>${touch ? "Hold" : "Hold R:"} REPAY</b> pays it back.`;
    // Each bubble sits just left of its own button (BOOST bottom-right, REPAY above it).
    const pos = boost ? "bottom:max(28px,calc(env(safe-area-inset-bottom) + 28px));right:122px" : "bottom:120px;right:98px";
    shownAt = lastE;
    el.innerHTML = `<div class="sticker absolute flex max-w-52 items-center gap-2 rounded-box bg-paper px-2.5 py-1.5 text-xs text-ink" style="${pos}">
      <span>${text}</span><b class="font-display text-lg text-liq">→</b>
      <button data-got class="pointer-events-auto tag shrink-0 rounded-field border-2 border-ink px-2 py-0.5 text-[11px]">OK</button></div>`;
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
