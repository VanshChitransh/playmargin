// Path router on the History API: playmargin.fun/play, /verify/<id>, /r/<CODE>. Each screen gets
// the root and returns its own cleanup, so leaving /play can tear down the Pixi canvas and the room
// connection. Old hash links (/#/verify/x, shared certificates, README links) are rewritten to the
// clean path on load, so nothing that was ever shared breaks. Hosting serves index.html for every
// path (Cloudflare Pages SPA fallback, Vite dev does the same).

export type Params = Record<string, string>;
export type Cleanup = () => void;
export type Screen = (root: HTMLElement, params: Params) => Cleanup | void;

let render: () => void = () => {};

/** Re-run the current route (Play again on the same /play path changes no URL). */
export const rerender = (): void => render();

/** Go to an app path ("/play", "/verify/x"): a new history entry, then render. */
export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  render();
}

/** The clean path for an old hash link ("#/verify/x" -> "/verify/x"), keeping its query; else null. */
export function legacyPath(hash: string, search: string): string | null {
  if (!hash.startsWith("#/")) return null;
  // "#//evil.example/x" would be a cross-origin URL that replaceState refuses (blank page, L5-05).
  const p = hash.slice(1).replace(/^\/+/, "/");
  return p.includes("?") || !search ? p : `${p}${search}`;
}

/** The route key a path renders: the first pattern that matches, "*" (404) when none does. */
export function pickRoute(patterns: string[], path: string): { key: string; params: Params } {
  for (const key of patterns) {
    if (key === "*") continue;
    const params = match(key, path);
    if (params) return { key, params };
  }
  return { key: "*", params: {} };
}

/** Same-origin app links render here instead of reloading the page. */
function internalHref(a: HTMLAnchorElement, e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  if (a.target || a.hasAttribute("download") || a.origin !== location.origin) return null;
  // Real files (clips, brand images, the service worker) are fetched, not routed.
  if (/\.[a-z0-9]{2,5}$/i.test(a.pathname)) return null;
  return a.pathname + a.search + a.hash;
}

/** Route patterns like "/verify/:id"; the first match wins, "*" is the fallback. onRoute sees every path. */
export function startRouter(root: HTMLElement, routes: Record<string, Screen>, onRoute?: (path: string) => void): void {
  const legacy = legacyPath(location.hash, location.search);
  if (legacy) history.replaceState(history.state, "", legacy);
  let cleanup: Cleanup | void;
  render = (): void => {
    cleanup?.();
    root.replaceChildren();
    const path = location.pathname.replace(/\/+$/, "") || "/";
    const { key, params } = pickRoute(Object.keys(routes), path);
    onRoute?.(path);
    cleanup = routes[key]?.(root, params);
  };
  window.addEventListener("popstate", render);
  // An old hash link pasted while the app is open: same rewrite.
  window.addEventListener("hashchange", () => {
    const p = legacyPath(location.hash, location.search);
    if (p) navigate(p, true);
  });
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a");
    const href = a ? internalHref(a, e) : null;
    if (!href) return;
    e.preventDefault();
    if (href !== location.pathname + location.search + location.hash) navigate(href);
    else render();
  });
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

/** Hard reload at most once per minute per tab; false when that already happened (storage off too). */
export function reloadOnce(store: Pick<Storage, "getItem" | "setItem"> | null = safeSession(), now = Date.now()): boolean {
  const last = Number(store?.getItem("margin.chunkReload") ?? 0);
  if (!store || now - last < 60_000) return false;
  store.setItem("margin.chunkReload", String(now));
  location.reload();
  return true;
}

function safeSession(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/**
 * A screen whose code loads on first visit, so the home page does not ship the game engine
 * (QA-B-16). Leaving before the code arrives cancels it; otherwise the real cleanup runs.
 */
export function lazy(load: () => Promise<Screen>): Screen {
  return (root, params) => {
    let left = false;
    let cleanup: Cleanup | void;
    void load().then(
      (screen) => {
        if (!left) cleanup = screen(root, params);
      },
      // A tab opened before a redeploy asks for a chunk that no longer exists (Q01). Reload once to
      // get the new build; the session flag stops a loop if the chunk is truly missing.
      (err: unknown) => {
        if (reloadOnce()) return;
        console.error(err);
        root.textContent = "This page failed to load. Refresh to try again.";
      },
    );
    return () => {
      left = true;
      cleanup?.();
    };
  };
}
