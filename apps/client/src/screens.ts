// The 404 screen, in the same sticker style as every other page.
import type { Screen } from "./router";

export const notFound: Screen = (root) => {
  root.innerHTML = `
  <main class="grid min-h-full place-items-center bg-liq p-4 text-center text-ink">
    <div>
      <img src="/brand/rekt.png" alt="" class="sticker mx-auto w-28 rounded-box" />
      <h1 class="outlined mt-6 font-display text-7xl text-paper">404</h1>
      <p class="mt-2 text-lg">This page got liquidated.</p>
      <nav class="mt-6 flex flex-wrap justify-center gap-3">
        <a class="sticker sticker-press rounded-box bg-paper px-5 py-3 font-display text-xl" href="#/play">Practice free</a>
        <a class="sticker sticker-press rounded-box bg-ink px-5 py-3 font-display text-xl text-paper" href="#/">Home</a>
      </nav>
    </div>
  </main>`;
};
