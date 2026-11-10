// #/how: the three rules with a short real-gameplay clip each. Kept off the landing page so
// the home screen stays one idea (hero, live arena, play), and linked from its header.
import type { Screen } from "../router";
import { reducedMotion } from "../render/motion";
import { showStake } from "../stake";
import { laptopCapable } from "../device";
import { BTN, header } from "./chrome";

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
  <div class="min-h-full bg-paper text-ink">
    ${header()}
    <section class="px-4 pb-16 pt-4">
      <div class="mx-auto max-w-6xl">
        <span class="sticker inline-block rounded-field bg-warn px-3 py-1 text-sm font-bold" style="box-shadow:3px 3px 0 var(--color-ink)">Three rules, 90 seconds</span>
        <h1 class="mt-3 font-display text-5xl sm:text-6xl">How it works</h1>
      </div>
      <div class="mx-auto mt-8 grid max-w-6xl gap-6 md:grid-cols-3">
        ${STEPS.map(
          ([t, d, clip], i) => `<article class="sticker rounded-box bg-card p-5 ${["md:-rotate-1", "md:rotate-1", "md:-rotate-1"][i]}">
            <video src="/clips/${clip}.mp4" ${play} muted playsinline preload="metadata" aria-label="${t}: real gameplay"
              class="mb-4 aspect-square w-full rounded-field border-4 border-ink bg-ink object-cover"></video>
            <span class="sticker inline-grid size-10 place-items-center rounded-full ${["bg-safe", "bg-warn", "bg-liq text-paper"][i]} font-display text-xl" style="box-shadow:3px 3px 0 var(--color-ink)">${i + 1}</span>
            <h2 class="mt-3 font-display text-3xl">${t}</h2>
            <p class="mt-2 text-muted">${d}</p></article>`,
        ).join("")}
      </div>
      <div class="mx-auto mt-12 flex max-w-6xl flex-wrap items-center justify-between gap-4">
        ${laptopCapable() ? `<div class="flex flex-wrap gap-4">
          <a href="#/play" class="${BTN.go} px-7 py-4 text-2xl">▶ Practice free</a>
          <a href="#/cash" class="${BTN.ink} px-7 py-4 text-2xl">Play for <span data-stake>$1</span></a>
        </div>` : `<p class="font-display text-2xl">Play it on a laptop: mouse and keyboard.</p>`}
        <nav class="flex flex-wrap gap-3">
          <a href="https://github.com/VanshChitransh/playmargin" target="_blank" rel="noopener" aria-label="MARGIN source code on GitHub (opens in a new tab)" class="${BTN.small}">Code on GitHub</a>
          <a href="https://x.com/playmargin" target="_blank" rel="noopener" aria-label="MARGIN on X, @playmargin (opens in a new tab)" class="${BTN.small}">@playmargin on X</a>
        </nav>
      </div>
    </section>
  </div>`;
  void showStake(root);
};
