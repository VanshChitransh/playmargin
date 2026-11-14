// /how: the home page's "How it plays" story on its own page, between the shared nav and the
// big MARGIN footer, so it is the exact same look and the same six steps as the home section.
import "./home/hero.css";
import type { Screen } from "../router";
import { showStake } from "../stake";
import { header } from "./chrome";

export const how: Screen = (root) => {
  window.scrollTo(0, 0);
  root.innerHTML = `
  <div class="home how-page">
    ${header()}
    <main>
    <h1 class="sr-only">How MARGIN works</h1>
    <div data-home-story></div>
    <section class="h-top" style="padding:24px 24px 120px">
      <h2 style="font:800 clamp(40px,6vw,64px)/1 Geist,sans-serif;letter-spacing:-0.05em">Your turn.</h2>
      <p class="h-sub">One match is 90 seconds. No wallet, no sign-up.</p>
      <p class="h-micro" style="max-width:560px;margin:14px auto 22px;font-size:15px;line-height:1.6">
        <b>Cash out:</b> press <kbd>E</kbd> when the clock shows 0:45 to 0:10, then stay untouched for 4 seconds to bank what you hold.<br>
        <b>The zone:</b> from 0:30 the arena shrinks, and outside it you lose 4% of your mass every second.</p>
      <div class="h-play" style="width:auto;display:inline-flex"><a href="/cash" class="h-inv" style="display:flex;align-items:center;gap:.28em;white-space:nowrap">Paid test match</a><a href="/play" data-track="practice_click" class="h-go">Play free</a></div>
    </section>
    </main>
    <div data-home-footer></div>
  </div>`;
  let left = false;
  let stop = (): void => {};
  void import("./home/sections").then((m) => {
    if (!left) stop = m.mountSections(root);
  });
  void showStake(root);
  return () => {
    left = true;
    stop();
  };
};
