// The near.social block for the results and LIQUIDATED screens: the player's near.social avatar and
// name, and a "Post to near.social" button that shows the real post link once it lands. Renders
// nothing on testnet builds or for players who are not signed in, so callers mount it unconditionally.
import { signedInAccount } from "../player/name";
import { BTN } from "../screens/chrome";
import { SOCIAL_ON, profileUrl, socialProfile } from "./profile";
import { postResult, resultText, type ResultPost } from "./share";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Fill `el` with the share block for this result (no-op unless mainnet and signed in). */
export function mountSocialShare(el: HTMLElement, r: ResultPost, account = signedInAccount(), on = SOCIAL_ON): void {
  if (!on || !account) return;
  el.innerHTML = `<div class="flex flex-wrap items-center gap-3">
    <a data-s=who href="${profileUrl(account)}" target="_blank" rel="noopener" class="flex items-center gap-2 font-bold">
      <span data-s=av class="grid size-9 place-items-center overflow-hidden rounded-full border border-grid bg-sky font-display">${esc(account[0]?.toUpperCase() ?? "?")}</span>
      <span data-s=name class="max-w-[15ch] truncate">${esc(account)}</span></a>
    <button data-s=post class="${BTN.card} text-lg">Post to near.social</button>
    <p data-s=msg class="basis-full text-sm" role="status" aria-live="polite"></p></div>`;
  void socialProfile(account).then((p) => {
    if (!p) return;
    if (p.name) el.querySelector("[data-s=name]")!.textContent = p.name;
    if (p.avatarUrl) el.querySelector("[data-s=av]")!.innerHTML = `<img src="${esc(p.avatarUrl)}" alt="" class="size-full object-cover" />`;
  });
  const btn = el.querySelector<HTMLButtonElement>("[data-s=post]")!;
  const msg = el.querySelector<HTMLElement>("[data-s=msg]")!;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Posting";
    msg.textContent = "Approve in your wallet. It costs a tiny bit of gas, no deposit.";
    postResult(account, resultText(r))
      .then((url) => {
        btn.remove();
        msg.innerHTML = `Posted. <a href="${esc(url)}" target="_blank" rel="noopener" class="${BTN.small}">See it on near.social</a>`;
      })
      .catch((e: Error) => {
        btn.disabled = false;
        btn.textContent = "Try again";
        msg.textContent = e.message;
      });
  });
}
