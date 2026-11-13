// playmargin.fun home (research/margin/ui/drafts/d5-geist.html, Vansh's pick on 13 Nov). One centred
// headline and a pill play box, then the real engine running bots in a framed window, with a feed of
// its real events. The story, proof and footer sections mount from ./home/sections.
import "./home/hero.css";
import type { BlobView, GameEventMsg } from "@margin/core";
import type { Screen } from "../router";
import { navigate } from "../router";
import { laptopCapable } from "../device";
import { laptopCardHtml, wireLaptopCard } from "./laptop";
import { newRoomCode } from "../net/room-code";
import { showStake } from "../stake";
import { nameProblem } from "@margin/core";
import { playerName, setPlayerName, signedInAccount } from "../player/name";
import type { BlobLookup } from "./hero";

export const landing: Screen = (root) => {
  root.innerHTML = `
  <div class="home">
    <nav class="h-nav">
      <a href="/" class="h-brand" aria-label="MARGIN home"><i><img src="/brand/margin-cat-cutout.svg" alt="" /></i>MARGIN</a>
      <div class="h-links">
        <a href="/how">How it works</a>
        <a href="#proof" data-proof-link>Verify</a>
        <a href="/cash" class="h-quiet">Play for <span data-stake>$1</span></a>
        <a href="/judges" class="h-judge">Judging? Start here</a>
      </div>
    </nav>
    <header class="h-top">
      <p class="h-eyebrow"><i></i>Live on NEAR</p>
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
    <section class="h-window" aria-label="Live match: bots playing on the real rules">
      <div class="h-bar">
        <p class="h-label"><i data-live></i>Live on NEAR · humans and 🤖 bots, same rules</p>
        <p class="h-keys"><span><kbd>Space</kbd>boost</span><span><kbd>R</kbd>repay</span><span><kbd>E</kbd>cash out</span></p>
      </div>
      <div class="h-stage"><div data-hero class="h-arena"></div><div data-feed class="h-feed" aria-live="off"></div></div>
    </section>
    <div data-home-story></div><div data-home-proof></div><div data-home-footer></div>
  </div>`;
  let left = false;
  let stop = (): void => {};
  let stopSections = (): void => {};
  void import("./home/sections").then((m) => {
    if (!left) stopSections = m.mountSections(root);
  });
  root.querySelector("[data-proof-link]")!.addEventListener("click", (e) => {
    e.preventDefault();
    root.querySelector("[data-home-proof]")?.scrollIntoView({ behavior: "smooth" });
  });
  void showStake(root);
  const cleanup = (): void => {
    left = true;
    stop();
    stopSections();
  };
  // Phones and tablets: no play box and no live arena (the renderer is what broke on a real
  // phone). One card says MARGIN plays on a laptop, the window shows a still of real gameplay.
  if (!laptopCapable()) {
    const ctas = root.querySelector<HTMLElement>("[data-ctas]")!;
    ctas.outerHTML = `<div data-laptop class="h-laptop">${laptopCardHtml()}</div>`;
    wireLaptopCard(root.querySelector<HTMLElement>("[data-laptop]")!);
    root.querySelector<HTMLElement>("[data-hero]")!.innerHTML = `<img src="/brand/hero-still.jpg" alt="A real MARGIN match: blobs, food and spikes on the grid" />`;
    root.querySelector("[data-live]")?.remove(); // a still image is not live
    root.querySelector(".h-keys")?.remove();
    return cleanup;
  }
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
  const feed = feedOf(root.querySelector<HTMLElement>("[data-feed]")!);
  // The live arena (pixi + the game engine) loads after first paint, so the buttons answer at once.
  const box = root.querySelector<HTMLElement>("[data-hero]")!;
  const idle = (f: () => void): void => void ("requestIdleCallback" in window ? requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 300));
  idle(() => {
    if (left) return;
    void import("./hero").then(({ mountHero }) => {
      if (!left) stop = mountHero(box, feed.push);
    });
  });
  return () => {
    feed.stop();
    cleanup();
  };
};

type Tone = "gold" | "safe" | "warn" | "liq" | "";
const RANK: Record<Tone, number> = { liq: 3, warn: 2, safe: 2, "": 2, gold: 1 };
const FEED_MS = 1200;
// A pop is the loudest line: at most one every 8 s so the feed shows the whole game, not just deaths.
const POP_GAP_MS = 8000;

/** The live feed: real engine events, one new line per 1.2 s at most, the 3 newest on screen. */
function feedOf(el: HTMLElement): { push: (e: GameEventMsg, blob: BlobLookup) => void; stop: () => void } {
  let next: { text: string; tone: Tone } | null = null;
  let lastPop = -POP_GAP_MS;
  const show = (): void => {
    if (!next) return;
    const row = document.createElement("div");
    row.className = next.tone;
    const dot = document.createElement("b");
    dot.textContent = "● ";
    row.append(dot, next.text);
    el.append(row);
    while (el.children.length > 3) el.firstElementChild!.remove();
    next = null;
  };
  const timer = setInterval(show, FEED_MS);
  return {
    push: (e, blob) => {
      const line = feedLine(e, blob);
      if (!line) return;
      if (line.tone === "liq") {
        if (performance.now() - lastPop < POP_GAP_MS) return;
        lastPop = performance.now();
      }
      // Bots borrow almost every second, so a boost only takes an empty slot: any other event outranks it.
      if (next && RANK[line.tone] < RANK[next.tone]) return;
      if (line.text === el.lastElementChild?.textContent?.slice(2)) return;
      next = line;
    },
    stop: () => clearInterval(timer),
  };
}

const who = (b: BlobView | undefined): string => (b ? (b.kind === "agent" ? `${b.label} 🤖` : b.label) : "A blob");

/** One feed line for a real engine event (null: not worth a line). */
export function feedLine(e: GameEventMsg, blob: BlobLookup): { text: string; tone: Tone } | null {
  switch (e.type) {
    case "boost": {
      const b = blob(e.blob);
      // Leverage = mass / equity, and mass = owe + equity in display units.
      const x = b && b.equity > 0 ? (b.owe + b.equity) / b.equity : 0;
      return { text: x >= 1.1 ? `${who(b)} boosts to ${Math.min(2.5, x).toFixed(1)}x` : `${who(b)} borrows from the vault`, tone: "gold" };
    }
    case "repay": {
      const b = blob(e.blob);
      return { text: b && b.owe < 0.5 ? `${who(b)} paid off the loan` : `${who(b)} repays the vault`, tone: "safe" };
    }
    case "spikeHit":
      return { text: `${who(blob(e.blob))} hit a spike. -${Math.round(e.damage)}`, tone: "warn" };
    case "eat":
      return { text: `${who(blob(e.by))} ate ${blob(e.victim)?.label ?? "a blob"}`, tone: "" };
    case "pop":
      return e.keeper || !e.by
        ? { text: `The vault popped ${blob(e.victim)?.label ?? "a blob"}`, tone: "liq" }
        : { text: `${who(blob(e.by))} popped ${blob(e.victim)?.label ?? "a blob"}. +8% bounty`, tone: "liq" };
    case "cashoutStart":
      return { text: `${who(blob(e.blob))} is cashing out`, tone: "safe" };
    case "cashedOut":
      return { text: `${who(blob(e.blob))} cashed out ${Math.round(e.amount)}`, tone: "safe" };
    default:
      return null;
  }
}
