// First-match coach marks for a brand-new guest: two bubbles pointing at BOOST and REPAY,
// shown once per browser, dismissed by "Got it" or by playing on. localStorage in try/catch:
// in a private window it may just show again, which is harmless.
const KEY = "margin.coached";

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

/** Mount the coach marks if this browser has never seen them. Returns a close function. */
export function coachMarks(root: HTMLElement, touch: boolean): () => void {
  if (seen()) return () => {};
  const el = document.createElement("div");
  el.className = "pointer-events-none fixed bottom-0 right-0 z-10 flex flex-col items-end gap-3 p-4 pb-[max(16px,env(safe-area-inset-bottom))] pr-[max(110px,calc(env(safe-area-inset-right)+110px))]";
  const bubble = (text: string, extra = ""): string =>
    `<div class="sticker relative rounded-box bg-paper px-3 py-2 text-sm text-ink ${extra}">${text} <b class="font-display text-lg text-liq">→</b></div>`;
  el.innerHTML = `
    ${bubble(`<b>${touch ? "Tap" : "Press R or tap"} REPAY</b> to pay the loan back. It is the only way out of red.`, "mb-6")}
    ${bubble(`<b>${touch ? "Hold" : "Hold SPACE or"} BOOST</b> to grow and speed up. Every boost is a loan.`)}
    <button data-got class="pointer-events-auto sticker sticker-press rounded-box bg-liq px-4 py-1 font-display text-lg text-paper">Got it</button>`;
  const close = (): void => {
    markSeen();
    el.remove();
  };
  el.querySelector("[data-got]")!.addEventListener("click", close);
  root.appendChild(el);
  return close;
}
