// Placeholder screens for every route. Each is replaced by its real task:
// landing U5, play U1 to U4, judge M9b, verify U8, room code U11.
import type { Screen } from "./router";

const shell = (title: string, body: string): string => `
  <main class="grid h-full place-items-center p-4 text-center">
    <div class="space-y-4">
      <h1 class="font-display text-6xl tracking-wide">${title}</h1>
      <p class="text-muted">${body}</p>
      <nav class="flex flex-wrap justify-center gap-2">
        <a class="btn btn-primary" href="#/play">Practice free</a>
        <a class="btn btn-ghost" href="#/">Home</a>
      </nav>
    </div>
  </main>`;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const landing: Screen = (root) => {
  root.innerHTML = shell("MARGIN", "The lending market is the arena. Get greedy. Get liquidated.");
};
export const judge: Screen = (root) => {
  root.innerHTML = shell("Judge run", "A seeded first match. Coming soon.");
};
export const verify: Screen = (root, { id = "" }) => {
  root.innerHTML = shell("Verify", `Match <span class="num text-gold">${esc(id)}</span>`);
};
export const room: Screen = (root, { code = "" }) => {
  root.innerHTML = shell("Private room", `Code <span class="num">${esc(code)}</span>`);
};
export const notFound: Screen = (root) => {
  root.innerHTML = shell("404", "No such page.");
};
