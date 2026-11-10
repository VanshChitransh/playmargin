// playmargin.fun landing ("Arcade Paper", research/margin/ui/variants/v1). The hero IS the game: a bots-only
// match on the real rules runs in a paper frame, so a judge sees BOOST, red rings and pops before reading a word
// (inspiration.md section 3: live mini arena + one CTA, crypto invisible above the fold).
import { LocalMatch } from "../game/local";
import { ArenaRenderer } from "../render/arena";
import { Director } from "../render/director";
import type { Frame } from "../game/frame";
import type { Screen } from "../router";
import { newRoomCode } from "../net/room-code";
import { ENDPOINT } from "../net/client";
import { showStake } from "../stake";
import { nameProblem } from "@margin/core";
import { playerName, setPlayerName, signedInAccount } from "../player/name";

export const landing: Screen = (root) => {
  root.innerHTML = `
  <div class="paper-dots flex min-h-dvh flex-col overflow-x-hidden text-ink">
    <header class="mx-auto flex w-full max-w-[88rem] items-center justify-between gap-3 px-4 pt-5 pb-2 xl:px-16 xl:pt-8">
      <a href="#/" aria-label="MARGIN home" class="flex items-center gap-3">
        <span class="pop flex size-12 items-end justify-center overflow-hidden rounded-2xl bg-sky xl:size-15"><img src="/brand/margin-cat-cutout.svg" alt="" class="-mb-1.5 w-[105%]" /></span>
        <span class="hidden font-display text-3xl tracking-wide min-[420px]:inline xl:text-4xl">MARGIN</span>
      </a>
      <nav class="flex items-center gap-2 whitespace-nowrap sm:gap-3">
        <a href="#/how" class="pop-sm pop-press rounded-xl bg-card px-3 py-2 text-sm font-bold sm:px-5 sm:py-3 sm:text-base">How it works</a>
        <a href="#/judge" class="pop-sm pop-press rounded-xl bg-ink px-3 py-2 text-sm font-bold text-card sm:px-5 sm:py-3 sm:text-base" title="A seeded 90 s match on normal rules"><span class="text-warn">&#9733;</span> Judge Run</a>
      </nav>
    </header>
    <main class="mx-auto grid w-full max-w-[88rem] flex-1 items-center gap-12 px-4 pt-4 pb-8 lg:grid-cols-[1fr_1fr] xl:gap-16 xl:px-16">
      <section class="min-w-0">
        <p class="pop-sm inline-block rounded-full bg-warn px-4 py-2 text-sm font-bold">The lending market is the arena</p>
        <h1 class="mt-4 font-display text-6xl leading-[0.9] min-[400px]:text-7xl sm:text-8xl xl:text-[7.6rem]"><span class="whitespace-nowrap">Get greedy.</span>
          <span class="mt-3 block text-3xl text-muted xl:text-[2.75rem]">(then get <em class="pop-sm ml-1 inline-block -rotate-2 rounded-xl bg-liq px-3 pb-1.5 not-italic text-card">liquidated.</em>)</span>
        </h1>
        <p class="mt-5 max-w-xl text-lg font-medium text-muted xl:text-[1.3rem] xl:leading-relaxed">A 90-second arena where <b class="font-bold text-ink">BOOST is a loan.</b> Borrow to grow, hunt the ones who went red, cash out before the vault pops you.</p>
        <div class="mt-5 flex flex-wrap items-center gap-4">
          <a href="#/play" class="pop pop-press flex h-16 items-center gap-3 rounded-2xl bg-safe px-7 font-display text-2xl xl:h-[4.75rem] xl:text-3xl">&#9654; Practice free</a>
          <a href="#/cash" class="pop pop-press flex h-16 items-center rounded-2xl bg-ink px-6 font-display text-2xl text-card xl:h-[4.75rem]">Play for&nbsp;<span data-stake>$1</span></a>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button data-challenge class="pop pop-press flex h-14 shrink-0 items-center gap-2.5 rounded-2xl bg-warn px-5 font-display text-xl xl:text-[1.375rem]">
            <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>Challenge a friend</button>
          <p class="text-sm font-semibold leading-snug text-muted"><b class="block text-base text-ink">Private room link</b>Send it, they join your match.</p>
        </div>
        <div class="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold text-muted">
          <label class="flex items-center gap-2"><span class="shrink-0">Your name</span>
            <input data-name maxlength=15 autocomplete=nickname class="pop-sm w-40 rounded-lg bg-card px-2 py-1 font-display text-lg text-ink placeholder:text-ink/40" /></label>
          <p data-name-why role="status" class="hidden basis-full text-sm font-bold text-[#B42328]"></p>
          <span class="flex items-center gap-2"><span class="size-2.5 rounded-full border-2 border-ink bg-safe"></span>No wallet. No sign-up.</span>
          <span class="pointer-coarse:hidden">Mouse steers, hold <kbd class="pop-sm rounded-md bg-card px-1.5 text-xs font-bold">Space</kbd> = BOOST</span>
        </div>
      </section>
      <section class="relative min-w-0 lg:pl-6">
        <img src="/brand/margin-cat-cutout.svg" alt="" class="pointer-events-none absolute -top-14 -left-2 z-10 w-24 -rotate-12 drop-shadow-[5px_6px_0_var(--color-ink)] sm:w-32 lg:-top-20 lg:-left-6 xl:w-40" />
        <div class="pop overflow-hidden rounded-[1.6rem] bg-card shadow-[12px_12px_0_var(--color-ink)] lg:rotate-[1.5deg]">
          <div class="flex h-11 items-center gap-2.5 border-b-4 border-ink bg-cream px-4">
            <i class="size-3.5 rounded-full border-[2.5px] border-ink bg-card"></i><i class="size-3.5 rounded-full border-[2.5px] border-ink bg-card"></i><i class="size-3.5 rounded-full border-[2.5px] border-ink bg-card"></i>
            <span class="ml-auto flex items-center gap-2 text-sm font-bold"><span class="size-3 rounded-full border-2 border-ink bg-liq"></span>LIVE</span>
          </div>
          <div data-hero class="relative aspect-[4/3] w-full overflow-hidden bg-[#eef6ff]"></div>
        </div>
        <span class="pop-sm absolute -right-1 -bottom-6 z-10 -rotate-3 rounded-full bg-warn px-4 py-2 text-sm font-bold xl:-right-4 xl:text-base">Live: bots playing on the real rules</span>
      </section>
    </main>
    <div data-proof class="mx-auto mb-8 hidden w-full max-w-[88rem] grid-cols-1 gap-4 px-4 sm:grid-cols-3 xl:px-16"></div>
  </div>`;
  void showStake(root);

  // A private room is just a fresh code: the first one in creates it, the friend's link joins it.
  // Proof strip: real counts from the server, a number that is still 0 is left out, never padded.
  void fetch(`${ENDPOINT}/api/stats`)
    .then((r) => (r.ok ? (r.json() as Promise<{ matches: number; players: number; agentPops: number }>) : null))
    .then((s) => {
      if (!s) return;
      // Real counts only: a number that is still 0 is left out, never padded.
      const cards = (
        [
          [s.matches, "match played", "matches played", "on the real rules", ""],
          [s.players, "player", "players", "in the arena", ""],
          [s.agentPops, "liquidation", "liquidations", "by AI agents", "text-liq"],
        ] as const
      ).filter(([n]) => n > 0);
      const el = root.querySelector<HTMLElement>("[data-proof]");
      if (!el || !cards.length) return;
      el.innerHTML = cards
        .map(
          ([n, one, many, sub, cls]) =>
            `<div class="pop flex items-center gap-4 rounded-2xl bg-card px-5 py-3.5"><span class="font-display text-5xl ${cls}">${n.toLocaleString()}</span><span class="text-base font-semibold leading-tight text-muted"><b class="block text-ink">${n === 1 ? one : many}</b>${sub}</span></div>`,
        )
        .join("");
      el.classList.replace("hidden", "grid");
    })
    .catch(() => {});
  // Mini Militia style: the name is set here once and used in practice, public and private rooms.
  const name = root.querySelector<HTMLInputElement>("[data-name]")!;
  name.value = playerName() ?? "";
  name.placeholder = signedInAccount() ?? "Player";
  // Never blank a name silently: say why the rules changed or refused it (QA-B-09).
  const why = root.querySelector<HTMLElement>("[data-name-why]")!;
  name.addEventListener("change", () => {
    // Clearing the box is fine (you play as Player N), so only a typed name gets a reason.
    const problem = name.value.trim() ? nameProblem(name.value) : null;
    name.value = setPlayerName(name.value) ?? "";
    why.textContent = problem ?? "";
    why.classList.toggle("hidden", !problem);
  });
  root.querySelector("[data-challenge]")!.addEventListener("click", () => (location.hash = `#/r/${newRoomCode()}`));
  const box = root.querySelector<HTMLElement>("[data-hero]")!;
  const arena = new ArenaRenderer();
  // Nobody is followed: the spectator director films the best action (a pop, a red blob with a
  // hunter near, a chase) and eases between shots. Following one bot left the shot dead whenever
  // that bot went quiet.
  const director = new Director();
  arena.director = (f, tS) => director.shot(f, tS);
  let last: Frame | null = null;
  const hero = (): LocalMatch => {
    const m = newHero();
    m.onEvent((e) => director.event(e, last, performance.now() / 1000));
    return m;
  };
  let match = hero();
  let left = false;
  let mounted = false;
  void arena
    .mount(
      box,
      (now) => {
        // A fresh match at the bell, or when fewer than 3 blobs are left to watch.
        let f = match.frameAt(now);
        if (f.match.phase === "ENDED" || f.blobs.filter((b) => b.state === "alive").length < 3) f = (match = hero()).frameAt(now);
        last = { ...f, me: "" };
        return last;
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

// Greedy bots (hero only): same engine and rules, but half the bots over-borrow, so red rings and
// liquidations show up in the first seconds instead of almost never.
const newHero = (): LocalMatch => new LocalMatch({ seed: (Math.random() * 1e9) | 0, withMe: false, bots: 10, warmupS: 0, greedy: true });
