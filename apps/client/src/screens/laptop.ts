// "MARGIN plays on a laptop": what a phone or tablet sees instead of the game (laptop only for
// now, docs/future_feature.md). One card with the link to take to a laptop; How it works and
// Verify stay open on phones.
import type { Screen } from "../router";
import { BTN, header } from "./chrome";
import { track } from "../analytics/track";

/** The card's inner HTML (also used on the home page in place of the play buttons). */
export function laptopCardHtml(room?: string): string {
  // The code comes from the URL: only plain letters and digits ever reach the HTML.
  if (room && !/^[A-Za-z0-9]{2,12}$/.test(room)) room = undefined;
  const what = room ? `Open this link on a laptop to join <b class="whitespace-nowrap">Room ${room}</b>.` : "Open it on a laptop to play.";
  return `<div class="pop rounded-[24px] bg-card p-5 text-ink">
    <h2 class="font-display text-3xl leading-tight">MARGIN plays on a laptop.</h2>
    <p class="mt-2 font-medium text-muted">${what} You steer with the mouse and hold Space to borrow, so it needs a keyboard and mouse.</p>
    <div class="mt-4 flex flex-wrap gap-3">
      <button data-copy class="${BTN.go}">Copy link</button>
      <button data-send class="${BTN.card} hidden">Send it to yourself</button>
      <a href="/how" class="${BTN.card}">How it works</a>
    </div>
  </div>`;
}

/** Wire the card's buttons: copy the link (the room link for an invite), or the share sheet. */
export function wireLaptopCard(el: HTMLElement): void {
  track("laptop_card_shown");
  const url = location.pathname.startsWith("/r/") ? location.href : `${location.origin}/`;
  const copy = el.querySelector<HTMLButtonElement>("[data-copy]")!;
  copy.addEventListener("click", () =>
    void navigator.clipboard.writeText(url).then(
      () => void (copy.textContent = "Link copied"),
      () => void (copy.textContent = url),
    ),
  );
  const send = el.querySelector<HTMLButtonElement>("[data-send]")!;
  const data = { title: "MARGIN", text: "Open MARGIN on my laptop", url };
  if (navigator.canShare?.(data)) {
    send.classList.remove("hidden");
    send.addEventListener("click", () => void navigator.share(data).catch(() => {}));
  }
}

/** The full page for game routes on a phone: header, the card, nothing that starts the renderer. */
export const laptopOnly: Screen = (root, params) => {
  root.innerHTML = `<div class="paper-dots flex min-h-full flex-col text-ink">${header()}
    <main class="mx-auto grid w-full max-w-lg flex-1 place-items-center px-4 pb-16">${laptopCardHtml(params.code)}</main></div>`;
  wireLaptopCard(root);
};
