// Hash router: works on any static host (Cloudflare Pages, a phone on the LAN) with
// no server rewrite rules. Each screen gets the root and returns its own cleanup,
// so leaving #/play can tear down the Pixi canvas and the room connection.

export type Params = Record<string, string>;
export type Cleanup = () => void;
export type Screen = (root: HTMLElement, params: Params) => Cleanup | void;

let render: () => void = () => {};

/** Re-run the current route (Play again on the same #/play hash fires no hashchange). */
export const rerender = (): void => render();

/** Route patterns like "/verify/:id"; the first match wins, "*" is the fallback. */
export function startRouter(root: HTMLElement, routes: Record<string, Screen>): void {
  let cleanup: Cleanup | void;
  render = (): void => {
    cleanup?.();
    root.replaceChildren();
    const path = location.hash.replace(/^#/, "") || "/";
    for (const [pattern, screen] of Object.entries(routes)) {
      const params = match(pattern, path);
      if (params) {
        cleanup = screen(root, params);
        return;
      }
    }
    cleanup = routes["*"]?.(root, {});
  };
  window.addEventListener("hashchange", render);
  render();
}

/** Params for a path if it matches the pattern, else null. */
export function match(pattern: string, path: string): Params | null {
  const p = pattern.split("/");
  const s = path.split("/");
  if (p.length !== s.length) return null;
  const params: Params = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(":")) {
      if (!s[i]) return null;
      params[seg.slice(1)] = decodeURIComponent(s[i]!);
    } else if (seg !== s[i]) return null;
  }
  return params;
}

/**
 * A screen whose code loads on first visit, so the home page does not ship the game engine
 * (QA-B-16). Leaving before the code arrives cancels it; otherwise the real cleanup runs.
 */
export function lazy(load: () => Promise<Screen>): Screen {
  return (root, params) => {
    let left = false;
    let cleanup: Cleanup | void;
    void load().then((screen) => {
      if (!left) cleanup = screen(root, params);
    });
    return () => {
      left = true;
      cleanup?.();
    };
  };
}
