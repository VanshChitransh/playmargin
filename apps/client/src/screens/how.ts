// #/how: the three rules with a short real-gameplay clip each. Kept off the landing page so
// the home screen stays one idea (hero, live arena, play), and linked from its header.
import type { Screen } from "../router";
import { reducedMotion } from "../render/motion";

// Each card plays a few seconds of real play (scripts/clips.sh, offline practice on the real rules).
const STEPS: Array<[string, string, string]> = [
  ["BOOST = borrow", "Hold BOOST to borrow from the vault: bigger and faster while it burns. The ring is your fuel.", "nitro"],
  ["Red? REPAY", "Losses eat your margin. Go red and you cannot eat. Hold REPAY to pay the loan back and get out.", "repay"],
  ["Stay red, get popped", "Any blob that touches a red blob pops it and takes a bounty. Cash out from 0:45 to keep your winnings.", "liquidated"],
];
// Autoplay only for players who did not ask for less motion; the rest get a tap-to-play video.
const play = reducedMotion ? "controls" : "autoplay loop";

export const how: Screen = (root) => {
  window.scrollTo(0, 0);
  root.innerHTML = `
  <div class="min-h-full bg-ink text-paper">
    <header class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
      <a href="#/" class="flex items-center gap-3">
        <img src="/brand/margin-icon.svg" alt="" class="sticker size-11 rounded-field" />
        <span class="outlined font-display text-3xl text-paper">MARGIN</span>
      </a>
      <a href="#/" class="tag">Back</a>
    </header>
    <section class="px-4 pb-16 pt-6">
      <h2 class="outlined mx-auto max-w-6xl font-display text-5xl">How it works</h2>
      <div class="mx-auto mt-8 grid max-w-6xl gap-6 md:grid-cols-3">
        ${STEPS.map(
          ([t, d, clip], i) => `<article class="sticker rounded-box bg-paper p-5 text-ink" style="box-shadow:6px 6px 0 var(--color-liq)">
            <video src="/clips/${clip}.mp4" ${play} muted playsinline preload="metadata" aria-label="${t}: real gameplay"
              class="mb-4 aspect-square w-full rounded-field border-4 border-ink bg-ink object-cover"></video>
            <span class="tag text-liq">0${i + 1}</span>
            <h3 class="mt-1 font-display text-3xl">${t}</h3>
            <p class="mt-2">${d}</p></article>`,
        ).join("")}
      </div>
      <div class="mx-auto mt-12 flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <a href="#/play" class="sticker sticker-press rounded-box bg-liq px-7 py-4 font-display text-2xl text-paper" style="box-shadow:6px 6px 0 var(--color-paper)">Play now</a>
        <nav class="tag flex gap-6 text-muted">
          <a href="https://github.com/VanshChitransh/playmargin" target="_blank" rel="noopener">Code</a>
          <a href="https://x.com/playmargin" target="_blank" rel="noopener">X</a>
          <span>playmargin.fun</span>
        </nav>
      </div>
    </section>
  </div>`;
};
