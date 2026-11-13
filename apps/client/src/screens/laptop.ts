// "MARGIN plays on a laptop": what a phone or tablet sees instead of the game itself (play, $1, Judge
// Run, a room link; gated in index.ts, docs/future_feature.md has the mobile plan). Every other page
// stays readable on a phone under mountPhoneBanner. It shows one real clip and carries the link over.
import type { Screen } from "../router";
import { BTN } from "./chrome";
import { track } from "../analytics/track";

export const laptopOnly: Screen = (root, params) => {
  // The code comes from the URL: only plain letters and digits ever reach the HTML.
  const room = params.code && /^[A-Za-z0-9]{2,12}$/.test(params.code) ? params.code : undefined;
  const what = room
    ? `Open this link on your laptop to join <b class="whitespace-nowrap text-ink">Room ${room}</b>.`
    : `Open <b class="text-ink">playmargin.fun</b> on your laptop to play.`;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.innerHTML = `<main class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8 text-ink">
    <div class="flex items-center gap-2 font-display text-lg"><img src="/brand/margin-cat-cutout.svg" alt="" class="size-8" />MARGIN</div>
    <p class="mt-10 self-start rounded-full bg-cream px-3 py-1 text-sm font-semibold text-muted">Laptop only, for now</p>
    <h1 class="mt-4 font-display text-[40px] leading-[1.02]">MARGIN plays on a laptop.</h1>
    <p class="mt-3 text-[17px] leading-relaxed text-muted">${what} You steer with the mouse and hold Space to borrow, so it needs a keyboard and a mouse or trackpad.</p>
    <div class="mt-6 flex flex-wrap gap-3">
      <button data-copy class="${BTN.go}">Copy link</button>
      <button data-send class="${BTN.card} hidden">Send it to yourself</button>
    </div>
    <p class="mt-4 text-sm text-muted"><a href="/" class="font-semibold text-ink underline">Home</a> · <a href="/how" class="font-semibold text-ink underline">How it works</a> · <a href="/judges" class="font-semibold text-ink underline">For judges</a></p>
    <figure class="pop mt-10 overflow-hidden rounded-2xl bg-card">
      <video class="block aspect-video w-full bg-cream object-cover" src="/clips/liquidated.mp4" muted loop playsinline ${still ? "" : "autoplay"} preload="metadata" aria-label="Real gameplay: a greedy blob goes red and gets popped"></video>
      <figcaption class="px-4 py-3 text-sm text-muted"><b class="text-ink">Get greedy. Get liquidated.</b> agar.io, but your size is a loan.</figcaption>
    </figure>
  </main>`;
  track("laptop_card_shown");
  const url = location.href;
  const copy = root.querySelector<HTMLButtonElement>("[data-copy]")!;
  copy.addEventListener("click", () =>
    void navigator.clipboard.writeText(url).then(
      () => void (copy.textContent = "Link copied"),
      () => void (copy.textContent = url),
    ),
  );
  const send = root.querySelector<HTMLButtonElement>("[data-send]")!;
  const data = { title: "MARGIN", text: "Open MARGIN on my laptop", url };
  if (navigator.canShare?.(data)) {
    send.classList.remove("hidden");
    send.addEventListener("click", () => void navigator.share(data).catch(() => {}));
  }
};

/** Phones and tablets: a slim sticky note over every readable page, with the link to copy. */
export function mountPhoneBanner(): void {
  const bar = document.createElement("div");
  bar.setAttribute("role", "note");
  bar.className = "sticky top-0 z-50 flex items-center gap-3 border-b border-grid bg-ink px-4 py-2 text-sm text-white";
  bar.innerHTML = `<p class="min-w-0 flex-1 leading-snug"><b>MARGIN plays on a laptop.</b> Open playmargin.fun on your computer to play.</p>
    <button type="button" class="shrink-0 rounded-full bg-white px-3 py-1 font-semibold text-ink">Copy link</button>`;
  const btn = bar.querySelector("button")!;
  btn.addEventListener("click", () =>
    void navigator.clipboard.writeText("https://playmargin.fun").then(
      () => void (btn.textContent = "Copied"),
      () => void (btn.textContent = "playmargin.fun"),
    ),
  );
  document.body.prepend(bar);
}
