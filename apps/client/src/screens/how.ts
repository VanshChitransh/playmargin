// /how: the home page's "How it plays" story on its own page, between the shared nav and the
// big MARGIN footer, so it is the exact same look and the same six steps as the home section.
import "./home/hero.css";
import type { Screen } from "../router";
import { showStake } from "../stake";
import { laptopCapable } from "../device";
import { header } from "./chrome";

export const how: Screen = (root) => {
  window.scrollTo(0, 0);
  root.innerHTML = `
  <div class="home">
    ${header()}
    <div data-home-story></div>
    <section class="h-top" style="padding:24px 24px 120px">
      <h2 style="font:800 clamp(40px,6vw,64px)/1 Geist,sans-serif;letter-spacing:-0.05em">Your turn.</h2>
      <p class="h-sub">One match is 90 seconds. No wallet, no sign-up.</p>
      ${laptopCapable()
        ? `<div class="h-play" style="width:auto;display:inline-flex"><a href="/cash" class="h-inv" style="white-space:nowrap">Play for <span data-stake>$1</span></a><a href="/play" data-track="practice_click" class="h-go">Play free</a></div>`
        : `<p class="h-micro">MARGIN plays on a laptop: mouse and keyboard.</p>`}
    </section>
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
