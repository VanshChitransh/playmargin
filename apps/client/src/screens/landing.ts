// playmargin.fun landing. The hero IS the game: a bots-only match on the real rules runs
// in a sticker frame, so a judge sees BOOST, red rings and pops before reading a word
// (inspiration.md section 3: live mini arena + one CTA, crypto invisible above the fold).
import { LocalMatch } from "../game/local";
import { ArenaRenderer } from "../render/arena";
import type { Screen } from "../router";

const STEPS: Array<[string, string]> = [
  ["BOOST = borrow", "Each tap borrows from the vault and makes you bigger and faster. Three taps, max."],
  ["Red ring = poppable", "Losses eat your margin. Go red and any blob that touches you pops you and takes a bounty."],
  ["Cash out to keep it", "Between 0:45 and 1:20, hold still for 4 s and walk away with your equity."],
];

export const landing: Screen = (root) => {
  root.innerHTML = `
  <div class="min-h-full overflow-x-hidden bg-liq text-ink">
    <header class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
      <a href="#/" class="flex items-center gap-3">
        <img src="/brand/margin-icon.svg" alt="" class="sticker size-11 rounded-field" />
        <span class="outlined font-display text-3xl text-paper">MARGIN</span>
      </a>
      <a href="#how" class="tag hidden sm:block">How it works</a>
    </header>
    <main class="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-4 lg:grid-cols-[1fr_1.1fr]">
      <section>
        <p class="tag">The lending market is the arena</p>
        <h1 class="mt-3 font-display leading-[0.9]">
          <span class="block -rotate-3 text-5xl">get</span>
          <span class="outlined block text-7xl text-paper sm:text-8xl">GREEDY.</span>
        </h1>
        <p class="tag mt-3">(then get liquidated.)</p>
        <p class="mt-6 max-w-md text-lg">A 90-second arena where BOOST is a loan. Borrow to grow, hunt the ones who went red, cash out before the vault pops you.</p>
        <div class="mt-8 flex flex-wrap items-center gap-4">
          <a href="#/play" class="sticker sticker-press rounded-box bg-paper px-7 py-4 font-display text-2xl">Practice free</a>
          <span class="text-sm">No wallet. No sign-up.<span class="pointer-coarse:hidden"><br />Mouse steers, <kbd class="kbd kbd-sm">Space</kbd> = BOOST</span></span>
        </div>
      </section>
      <section class="relative">
        <div data-hero class="sticker relative aspect-[4/3] w-full overflow-hidden rounded-box bg-ink"></div>
        <div class="sticker absolute -bottom-5 left-4 rounded-field bg-paper px-3 py-2 text-sm">
          <b>Live:</b> bots playing on the real rules
        </div>
        <img src="/brand/margin-cat-cutout.svg" alt="" class="pointer-events-none absolute -bottom-10 -right-4 w-28 rotate-6 sm:w-36" />
      </section>
    </main>
    <section id="how" class="bg-ink px-4 py-16 text-paper">
      <h2 class="outlined mx-auto max-w-6xl font-display text-5xl">How it works</h2>
      <div class="mx-auto mt-8 grid max-w-6xl gap-6 md:grid-cols-3">
        ${STEPS.map(
          ([t, d], i) => `<article class="sticker rounded-box bg-paper p-5 text-ink" style="box-shadow:6px 6px 0 var(--color-liq)">
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

  const box = root.querySelector<HTMLElement>("[data-hero]")!;
  const arena = new ArenaRenderer();
  let match = newHero();
  let left = false;
  let mounted = false;
  void arena
    .mount(
      box,
      (now) => {
        const f = match.frameAt(now);
        // Restart when the followed bot dies or the bell rings, so the hero never sits idle.
        const me = f.blobs.find((b) => b.id === f.me);
        if (f.match.phase === "ENDED" || me?.state !== "alive") match = newHero();
        return f;
      },
      { fit: box, view: 520 },
    )
    .then(() => {
      mounted = true;
      if (left) arena.destroy();
    });
  return () => {
    left = true;
    if (mounted) arena.destroy();
  };
};

const newHero = (): LocalMatch => new LocalMatch({ seed: (Math.random() * 1e9) | 0, withMe: false, bots: 10, warmupS: 0 });
