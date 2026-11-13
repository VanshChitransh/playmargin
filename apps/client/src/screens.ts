// The 404 screen, in the same look as every other page: shared nav, the cat, and the MARGIN footer.
import type { Screen } from "./router";
import { BTN, footerSlot, header, mountSiteFooter } from "./screens/chrome";

export const notFound: Screen = (root) => {
  root.innerHTML = `
  <div class="flex min-h-full flex-col bg-paper text-ink">
    ${header()}
    <main class="grid flex-1 place-items-center px-4 py-24 text-center">
      <div>
        <i class="mx-auto grid size-28 place-items-end overflow-hidden rounded-full bg-cobalt"><img src="/brand/margin-cat-cutout.svg" alt="" class="-mb-2 w-full" /></i>
        <h1 class="mt-6 font-display text-8xl">404</h1>
        <p class="mt-2 text-lg">This page got <span class="inline-block rounded-field bg-liq px-2 font-display text-white">liquidated.</span></p>
        <nav class="mt-8 flex flex-wrap justify-center gap-4">
          <a class="${BTN.go}" href="/play">▶ Practice free</a>
          <a class="${BTN.card}" href="/">Home</a>
        </nav>
      </div>
    </main>
    ${footerSlot}
  </div>`;
  return mountSiteFooter(root);
};
