// playmargin.fun home (research/margin/ui/drafts/d5-geist.html, Vansh's pick on 13 Nov). One centred
// headline and a pill play box, then a framed window looping real gameplay: footage of the engine
// (bots on the real rules) cut to the best moments. The story, proof and footer mount from ./home/sections.
import "./home/hero.css";
import type { Screen } from "../router";
import { navigate } from "../router";
import { newRoomCode } from "../net/room-code";
import { showStake } from "../stake";
import { VERIFY_EXAMPLE } from "./home/proof";
import { nameProblem } from "@margin/core";
import { playerName, setPlayerName, signedInAccount } from "../player/name";

export const landing: Screen = (root) => {
  root.innerHTML = `
  <div class="home">
    <nav class="h-nav">
      <a href="/" class="h-brand" aria-label="MARGIN home"><i><img src="/brand/margin-cat-cutout.svg" alt="" /></i>MARGIN</a>
      <div class="h-links">
        <a href="/how">How it works</a>
        <a href="${VERIFY_EXAMPLE}" title="A real settled match, checked in your browser">Verify</a>
        <a href="/cash" class="h-quiet">Play for <span data-stake>$1</span></a>
        <a href="/judges" class="h-judge">Judging? Start here</a>
      </div>
    </nav>
    <main>
    <header class="h-top">
      <p class="h-eyebrow"><i></i>Live on NEAR testnet</p>
      <h1>Get greedy. <span>Get liquidated.</span></h1>
      <p class="h-sub">agar.io, but your size is a loan. <b>Owe too much, you're food.</b></p>
      <div data-ctas>
        <div class="h-play">
          <input data-name maxlength="15" autocomplete="nickname" aria-label="Your name" placeholder="Your name" />
          <button type="button" data-challenge data-track="challenge_link_created" class="h-inv">Invite</button>
          <a href="/play" data-track="practice_click" class="h-go">Play free</a>
        </div>
        <p data-name-why role="status" class="h-why" hidden></p>
        <p class="h-micro">No wallet. No sign-up. 90 seconds.</p>
      </div>
    </header>
    <section class="h-window" aria-label="Real MARGIN gameplay">
      <div class="h-bar">
        <p class="h-label">Recorded gameplay · 🤖 bots on the real rules</p>
        <p class="h-keys"><span><kbd>Space</kbd>boost</span><span><kbd>R</kbd>repay</span><span><kbd>E</kbd>cash out</span></p>
      </div>
      <div class="h-stage"><video data-hero class="h-arena" muted loop playsinline autoplay preload="auto" poster="/home/hero-poster.jpg" aria-label="A player eats, borrows to grow with BOOST, then repays the loan"><source src="/home/hero-loop.mp4" type="video/mp4" /></video><div data-feed class="h-feed" aria-hidden="true"></div></div>
    </section>
    <div data-home-story></div><div data-home-proof></div>
    </main>
    <div data-home-footer></div>
  </div>`;
  let left = false;
  let stopSections = (): void => {};
  void import("./home/sections").then((m) => {
    if (!left) stopSections = m.mountSections(root);
    // Old links to /#proof still land on the proof block.
    if (!left && location.hash === "#proof") root.querySelector("[data-home-proof]")?.scrollIntoView();
  });
  void showStake(root);
  const cleanup = (): void => {
    left = true;
    stopSections();
  };
  // Reduced motion: the poster frame instead of a moving loop.
  const video = root.querySelector<HTMLVideoElement>("[data-hero]")!;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.removeAttribute("autoplay");
    video.pause();
  }
  feedOnVideo(video, root.querySelector<HTMLElement>("[data-feed]")!);
  // Mini Militia style: the name is set here once and used in practice, public and private rooms.
  const name = root.querySelector<HTMLInputElement>("[data-name]")!;
  name.value = playerName() ?? "";
  name.placeholder = signedInAccount() ?? "Your name";
  // Never blank a name silently: say why the rules changed or refused it (QA-B-09).
  const why = root.querySelector<HTMLElement>("[data-name-why]")!;
  name.addEventListener("change", () => {
    // Clearing the box is fine (you play as Player N), so only a typed name gets a reason.
    const problem = name.value.trim() ? nameProblem(name.value) : null;
    name.value = setPlayerName(name.value) ?? "";
    why.textContent = problem ?? "";
    why.hidden = !problem;
  });
  // A private room is just a fresh code: the first one in creates it, the friend's link joins it.
  root.querySelector("[data-challenge]")!.addEventListener("click", () => navigate(`/r/${newRoomCode()}`));
  return cleanup;
};

type Tone = "gold" | "warn" | "liq";
/** What happens on screen in hero-loop.mp4 (19.7 s, one take from GO, your own camera), at the second
 *  it shows. Re-time if the loop is re-cut. */
export const HERO_CUES: ReadonlyArray<{ at: number; text: string; tone: Tone }> = [
  { at: 0.4, text: "GO! You start at 80 and eat to grow", tone: "gold" },
  { at: 7.7, text: "You hold BOOST: a loan from the vault", tone: "gold" },
  { at: 9.4, text: "You owe 147, interest ticks every second", tone: "warn" },
  { at: 16.7, text: "You hold REPAY", tone: "gold" },
  { at: 17.6, text: "Paid off. Debt 0, equity 118", tone: "gold" },
];

/** Cues crossed when the clock moves from `from` to `to` (a loop restart counts from 0). */
export function cuesBetween(from: number, to: number): typeof HERO_CUES[number][] {
  const lo = to < from ? -1 : from;
  return HERO_CUES.filter((c) => c.at > lo && c.at <= to);
}

/** The feed follows the video clock, so each line lands with the moment it names. Newest 3 shown. */
function feedOnVideo(video: HTMLVideoElement, el: HTMLElement): void {
  const row = (c: (typeof HERO_CUES)[number]): HTMLElement => {
    const r = document.createElement("div");
    r.className = c.tone;
    const dot = document.createElement("b");
    dot.textContent = "● ";
    r.append(dot, c.text);
    return r;
  };
  let last = 0;
  let still = false;
  // A video that never plays (Reduce motion, Low Power Mode or blocked autoplay) still shows the story.
  const showStill = (): void => {
    if (!video.paused || video.currentTime > 0) return;
    still = true;
    el.replaceChildren(...HERO_CUES.slice(-3).map(row));
  };
  setTimeout(showStill, 1200);
  video.addEventListener("timeupdate", () => {
    const now = video.currentTime;
    if (still && now > 0) {
      still = false;
      el.replaceChildren();
    }
    for (const c of cuesBetween(last, now)) {
      el.append(row(c));
      while (el.children.length > 3) el.firstElementChild!.remove();
    }
    last = now;
  });
}
