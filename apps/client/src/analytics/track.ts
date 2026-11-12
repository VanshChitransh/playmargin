// Anonymous funnel events: names only, batched, sent with sendBeacon, never awaited, so nothing a
// player does ever waits on analytics. The id is a random UUID kept in this browser, separate from
// the guest key (it cannot be linked to credits). Do Not Track, Global Privacy Control or
// localStorage "margin.noTrack" = "1" turn it off completely: nothing is queued or sent.

/** Same list as the server allow-list (apps/server/src/analytics.ts EVENTS). */
export const EVENTS = [
  "home_view", "how_view", "judges_view", "verify_view", "laptop_card_shown",
  "practice_click", "warmup_done", "match_finished", "play_again", "challenge_link_created", "friend_joined",
] as const;
export type EventName = (typeof EVENTS)[number];

// Not imported from net/client: that pulls the Colyseus SDK into the light home bundle.
const env: Partial<ImportMetaEnv> = import.meta.env ?? {};
const SERVER = typeof location === "undefined" ? "" : (env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:2567`);
const FLUSH_MS = 5000;

const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked: this visit gets a throwaway id */
    }
  },
};

/** True when the visitor asked not to be tracked, in any of the three ways. */
export function optedOut(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean } = navigator, flag = store.get("margin.noTrack")): boolean {
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true || flag === "1";
}

let id: string | null = null;
const analyticsId = (): string => {
  id ??= store.get("margin.aid") ?? crypto.randomUUID();
  store.set("margin.aid", id);
  return id;
};

let queue: EventName[] = [];
let timer = 0;

function flush(): void {
  clearTimeout(timer);
  timer = 0;
  if (!queue.length || !SERVER) return;
  const body = JSON.stringify({ id: analyticsId(), events: queue });
  queue = [];
  // text/plain is a "simple" request: no CORS preflight, so the beacon always goes out.
  const blob = new Blob([body], { type: "text/plain" });
  if (!navigator.sendBeacon?.(`${SERVER}/api/events`, blob)) void fetch(`${SERVER}/api/events`, { method: "POST", body: blob, keepalive: true }).catch(() => {});
}

/** Queue one event. Fire and forget: returns at once, sends within FLUSH_MS or when the page hides. */
export function track(name: EventName): void {
  if (optedOut()) return;
  queue.push(name);
  if (queue.length >= 20) return flush();
  timer ||= window.setTimeout(flush, FLUSH_MS);
}

/** The page-view event for a route path, or null for pages we do not count. */
export function viewEvent(path: string): EventName | null {
  if (path === "/" || path === "") return "home_view";
  if (path === "/how") return "how_view";
  if (path === "/judges") return "judges_view";
  if (path.startsWith("/verify")) return "verify_view";
  return null;
}

/** Call on every route change. */
export function trackView(path: string): void {
  const e = viewEvent(path);
  if (e) track(e);
}

const ALLOWED = new Set<string>(EVENTS);
if (typeof document !== "undefined") {
  // Screens mark buttons with data-track="<event>" instead of calling code.
  document.addEventListener("click", (e) => {
    const name = (e.target as Element | null)?.closest?.("[data-track]")?.getAttribute("data-track");
    if (name && ALLOWED.has(name)) track(name as EventName);
  }, { capture: true, passive: true });
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}
