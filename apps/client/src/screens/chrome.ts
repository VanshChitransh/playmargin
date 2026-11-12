// Shared look for the secondary pages (how, cash, verify, 404): the Arcade Paper header
// (cat on a sky tile + MARGIN, How it works, Judge Run) and the sticker button classes,
// so every action on every page is a filled button, never an underlined link.

const base = "sticker sticker-press inline-block text-center rounded-box font-display disabled:opacity-50";
/** Filled sticker buttons, one per meaning: safe green = main action, card = secondary, ink = strong secondary, warn = friend. */
export const BTN = {
  go: `${base} bg-safe px-6 py-3 text-xl text-ink`,
  card: `${base} bg-card px-5 py-3 text-xl text-ink`,
  ink: `${base} bg-ink px-5 py-3 text-xl text-paper`,
  warn: `${base} bg-warn px-5 py-3 text-xl text-ink`,
  small: `${base} bg-card px-3 py-1.5 text-base text-ink`,
  smallInk: `${base} bg-ink px-3 py-1.5 text-base text-paper`,
} as const;

/** The page header shared with the home screen. */
export const header = (): string => `
  <header class="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4">
    <a href="/" class="flex items-center gap-3" aria-label="MARGIN home">
      <span class="sticker grid size-11 shrink-0 place-items-center overflow-hidden rounded-field bg-sky"><img src="/brand/margin-cat-cutout.svg" alt="" class="mt-2 w-9" /></span>
      <span class="hidden font-display text-3xl text-ink min-[420px]:inline">MARGIN</span>
    </a>
    <nav class="flex items-center gap-1.5 whitespace-nowrap sm:gap-3">
      <a href="/how" class="${BTN.small} max-sm:px-2 max-sm:text-sm">How it works</a>
      <a href="/judges" class="${BTN.small} max-sm:px-2 max-sm:text-sm" title="Every claim, checked live against NEAR"><span class="max-sm:hidden">For j</span><span class="sm:hidden">J</span>udges</a>
      <a href="/judge" class="${BTN.smallInk} max-sm:px-2 max-sm:text-sm" title="A seeded 90 s match on normal rules">★ Judge Run</a>
    </nav>
  </header>`;
