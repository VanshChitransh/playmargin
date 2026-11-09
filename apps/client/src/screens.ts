// Placeholder screens still waiting for their task: #/judge (M9b) and the 404.
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

export const judge: Screen = (root) => {
  root.innerHTML = shell("Judge run", "A seeded first match. Coming soon.");
};
export const notFound: Screen = (root) => {
  root.innerHTML = shell("404", "No such page.");
};
