// Shared look for the secondary pages (how, cash, verify, judges, 404): the same nav as the home
// page (drafts/d5-geist.html) and pill buttons, so moving between pages never changes the look.
import { VERIFY_EXAMPLE } from "./home/proof";

const base = "sticker-press inline-flex items-center justify-center gap-2 text-center rounded-full font-sans font-semibold transition-colors disabled:opacity-50";
/** Pill buttons, one per meaning: blue = main action, card = secondary, ink = strong secondary, warn = friend. */
export const BTN = {
  go: `${base} bg-cobalt px-6 py-3 text-lg text-white hover:bg-cobalt-dark`,
  card: `${base} border border-grid bg-card px-5 py-3 text-lg text-ink hover:bg-cream`,
  ink: `${base} bg-ink px-5 py-3 text-lg text-white hover:bg-ink/85`,
  warn: `${base} bg-warn px-5 py-3 text-lg text-ink`,
  small: `${base} border border-grid bg-card px-3.5 py-1.5 text-sm text-ink hover:bg-cream`,
  smallInk: `${base} bg-ink px-3.5 py-1.5 text-sm text-white hover:bg-ink/85`,
} as const;

const link = "rounded-full px-4 py-2.5 hover:bg-cream";
/** The page header, the same as the home nav. */
export const header = (): string => `
  <nav class="flex items-center justify-between gap-3 px-4 py-5 sm:px-12">
    <a href="/" class="flex items-center gap-2.5 text-[22px] font-extrabold tracking-[-0.02em]" aria-label="MARGIN home">
      <i class="grid size-[34px] place-items-end overflow-hidden rounded-full bg-cobalt"><img src="/brand/margin-cat-cutout.svg" alt="" class="-mb-[3px] w-full" /></i>
      <span class="max-[420px]:hidden">MARGIN</span>
    </a>
    <div class="flex items-center gap-1 whitespace-nowrap text-[15px] font-semibold">
      <a href="/how" class="${link} max-sm:hidden">How it works</a>
      <a href="${VERIFY_EXAMPLE}" class="${link} max-sm:hidden" title="A real settled match, checked in your browser">Verify</a>
      <a href="/cash" class="${link} text-muted max-md:hidden">Play for <span data-stake>$1</span></a>
      <a href="/judges" class="rounded-full bg-ink px-4 py-2.5 text-white! hover:bg-ink/85">Judging? Start here</a>
    </div>
  </nav>`;
