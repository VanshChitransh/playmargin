// playmargin.fun landing. The hero IS the game: a bots-only match on the real rules runs
// in a sticker frame, so a judge sees BOOST, red rings and pops before reading a word
// (inspiration.md section 3: live mini arena + one CTA, crypto invisible above the fold).
import { LocalMatch } from "../game/local";
import { ArenaRenderer } from "../render/arena";
import type { Screen } from "../router";
import { newRoomCode } from "../net/room-code";
import { ENDPOINT } from "../net/client";
import { showStake } from "../stake";

export const landing: Screen = (root) => {
  root.innerHTML = `
  <div class="flex min-h-dvh flex-col overflow-x-hidden bg-liq text-ink">
    <header class="mx-auto flex w-full max-w-[88rem] items-center justify-between px-4 py-4 xl:px-8">
      <a href="#/" class="flex items-center gap-3">
        <img src="/brand/margin-icon.svg" alt="" class="sticker size-11 rounded-field" />
        <span class="outlined hidden font-display text-3xl text-paper min-[420px]:inline">MARGIN</span>
      </a>
      <nav class="tag flex items-center gap-3 whitespace-nowrap sm:gap-5">
        <a href="#/how">How it works</a>
        <a href="#/judge" class="rounded-field border-2 border-ink px-2 py-1" title="A seeded 90 s match on normal rules">Judge Run</a>
      </nav>
    </header>
    <main class="mx-auto grid w-full max-w-[88rem] flex-1 items-center gap-10 px-4 pb-16 pt-4 lg:grid-cols-[1fr_1.35fr] xl:gap-16 xl:px-8">
      <section class="min-w-0">
        <p class="tag">The lending market is the arena</p>
        <h1 class="mt-3 font-display leading-[0.9]">
          <span class="block -rotate-3 text-5xl xl:text-7xl">get</span>
          <span class="outlined block text-7xl text-paper sm:text-8xl xl:text-[9.5rem]">GREEDY.</span>
        </h1>
        <p class="tag mt-3">(then get liquidated.)</p>
        <p class="mt-6 max-w-md text-lg xl:max-w-lg xl:text-2xl">A 90-second arena where BOOST is a loan. Borrow to grow, hunt the ones who went red, cash out before the vault pops you.</p>
        <div class="mt-8 flex flex-wrap items-center gap-4">
          <a href="#/play" class="sticker sticker-press rounded-box bg-paper px-7 py-4 font-display text-2xl xl:px-9 xl:py-5 xl:text-3xl">Practice free</a>
          <a href="#/cash" class="sticker sticker-press rounded-box bg-ink px-5 py-3 font-display text-xl text-paper xl:px-7 xl:py-4 xl:text-2xl">Play for <span data-stake>$1</span></a>
          <button data-challenge class="tag basis-full text-left underline">Challenge a friend: private room link</button>
          <p data-proof class="tag hidden basis-full"></p>
          <span class="text-sm xl:text-base">No wallet. No sign-up.<span class="pointer-coarse:hidden"><br />Mouse steers, hold <kbd class="kbd kbd-sm">Space</kbd> = BOOST</span></span>
        </div>
      </section>
      <section class="relative min-w-0">
        <div data-hero class="sticker relative aspect-[4/3] w-full overflow-hidden rounded-box bg-ink"></div>
        <div class="sticker absolute -bottom-5 left-4 rounded-field bg-paper px-3 py-2 text-sm xl:text-base">
          <b>Live:</b> bots playing on the real rules
        </div>
        <img src="/brand/margin-cat-cutout.svg" alt="" class="pointer-events-none absolute -bottom-12 -right-2 w-20 rotate-6 sm:-bottom-10 sm:-right-4 sm:w-36 xl:-right-8 xl:w-44" />
      </section>
    </main>
  </div>`;
  void showStake(root);

  // A private room is just a fresh code: the first one in creates it, the friend's link joins it.
  // Proof strip: real counts from the server, a number that is still 0 is left out, never padded.
  void fetch(`${ENDPOINT}/api/stats`)
    .then((r) => (r.ok ? (r.json() as Promise<{ matches: number; players: number; agentPops: number }>) : null))
    .then((s) => {
      if (!s) return;
      const parts = (
        [
          [s.matches, "match played", "matches played"],
          [s.players, "player", "players"],
          [s.agentPops, "liquidation by AI agents", "liquidations by AI agents"],
        ] as const
      )
        .filter(([n]) => n > 0)
        .map(([n, one, many]) => [n, n === 1 ? one : many] as const);
      const el = root.querySelector<HTMLElement>("[data-proof]");
      if (!el || !parts.length) return;
      el.innerHTML = parts.map(([n, t]) => `<b class="font-display text-lg text-ink">${n.toLocaleString()}</b> ${t}`).join(" · ");
      el.classList.remove("hidden");
    })
    .catch(() => {});
  root.querySelector("[data-challenge]")!.addEventListener("click", () => (location.hash = `#/r/${newRoomCode()}`));
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
      { fit: box, view: 1200 },
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
