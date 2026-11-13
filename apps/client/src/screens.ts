// The 404 screen, in the same Arcade Paper look as every other page.
import type { Screen } from "./router";
import { BTN, header } from "./screens/chrome";

export const notFound: Screen = (root) => {
  root.innerHTML = `
  <div class="flex min-h-full flex-col bg-paper text-ink">
    ${header()}
    <main class="grid flex-1 place-items-center px-4 pb-16 text-center">
      <div>
        <img src="/brand/rekt.png" alt="" class="sticker mx-auto w-28 rounded-box" />
        <h1 class="mt-6 font-display text-8xl">404</h1>
        <p class="mt-2 text-lg">This page got <span class="sticker inline-block rounded-field bg-liq px-2 font-display text-paper">liquidated.</span></p>
        <nav class="mt-8 flex flex-wrap justify-center gap-4">
          <a class="${BTN.go}" href="/play">▶ Practice free</a>
          <a class="${BTN.card}" href="/">Home</a>
        </nav>
      </div>
    </main>
  </div>`;
};
