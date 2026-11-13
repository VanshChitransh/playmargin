// playmargin.fun home (research/margin/ui/drafts/d5-geist.html, Vansh's pick on 13 Nov). One centred
// headline and a pill play box, then a framed window looping real gameplay: footage of the engine
// (bots on the real rules) cut to the best moments. The story, proof and footer mount from ./home/sections.
import "./home/hero.css";
import type { Screen } from "../router";
import { navigate } from "../router";
import { laptopCapable } from "../device";
import { laptopCardHtml, wireLaptopCard } from "./laptop";
import { newRoomCode } from "../net/room-code";
import { showStake } from "../stake";
import { nameProblem } from "@margin/core";
import { playerName, setPlayerName, signedInAccount } from "../player/name";

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
        <p class="h-label"><i data-live></i>Real gameplay · 🤖 bots on the real rules</p>
        <p class="h-keys"><span><kbd>Space</kbd>boost</span><span><kbd>R</kbd>repay</span><span><kbd>E</kbd>cash out</span></p>
      </div>
      <div class="h-stage"><video data-hero class="h-arena" muted loop playsinline autoplay preload="auto" poster="/home/hero-poster.jpg" aria-label="Bots borrow to grow, go red and get popped"><source src="/home/hero-loop.mp4" type="video/mp4" /></video></div>
    </section>
    <div data-home-story></div><div data-home-proof></div><div data-home-footer></div>
  </div>`;
  let left = false;
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
    stopSections();
  };
  // Reduced motion: the poster frame instead of a moving loop.
  const video = root.querySelector<HTMLVideoElement>("[data-hero]")!;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.removeAttribute("autoplay");
    video.pause();
  }
  // Phones and tablets: no play box (one card says MARGIN plays on a laptop). The footage is a
  // plain video, so it plays there too.
  if (!laptopCapable()) {
    const ctas = root.querySelector<HTMLElement>("[data-ctas]")!;
    ctas.outerHTML = `<div data-laptop class="h-laptop">${laptopCardHtml()}</div>`;
    wireLaptopCard(root.querySelector<HTMLElement>("[data-laptop]")!);
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
  return cleanup;
};
