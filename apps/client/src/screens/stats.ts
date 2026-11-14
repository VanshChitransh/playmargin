// /stats#key=...: the private analytics page. The key is checked by the server (a wrong or missing
// key looks like a 404 there too); it is moved out of the address bar at once and kept only for
// this tab, so a screenshot or a shared screen never shows it. Laptop layout, Arcade Paper.
import { ENDPOINT } from "../net/client";
import type { Screen } from "../router";
import { header } from "./chrome";

interface Day {
  day: string;
  n: number;
}
interface Insights {
  from: string;
  to: string;
  funnel: Array<{ day: string; event: string; n: number; guests: number }>;
  totals: Array<{ event: string; guests: number; guestDays: number }>;
  visitors: Day[];
  players: Day[];
  multi: Day[];
  paid: Day[];
  returning: number;
  stats: { users: number; players: number; matches: number; multiHumanPct: number; agentPops: number };
}

/** The funnel in the order a new visitor walks it. */
const STEPS: Array<[string, string]> = [
  ["home_view", "Saw the home page"],
  ["practice_click", "Pressed Practice free"],
  ["warmup_done", "Reached GO"],
  ["match_finished", "Finished a match"],
  ["play_again", "Pressed Play again"],
  ["challenge_link_created", "Made a challenge link"],
  ["friend_joined", "A friend joined"],
];
const PAGES: Array<[string, string]> = [["how_view", "How it works"], ["judges_view", "For judges"], ["verify_view", "Verify"], ["laptop_card_shown", "Phone card shown"]];

/** Every day from..to, so a quiet day shows as an empty bar instead of disappearing. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const tile = (n: number | string, label: string, sub = ""): string =>
  `<div class="pop rounded-2xl bg-card p-4"><div class="font-display text-4xl tabular-nums">${n}</div><div class="font-bold">${label}</div>${sub ? `<div class="text-sm text-muted">${sub}</div>` : ""}</div>`;

function bars(title: string, days: string[], series: Day[], color: string): string {
  const by = new Map(series.map((d) => [d.day, d.n]));
  const max = Math.max(1, ...series.map((d) => d.n));
  const total = series.reduce((a, d) => a + d.n, 0);
  return `<section class="pop rounded-2xl bg-card p-4">
    <div class="flex items-baseline justify-between"><h3 class="font-display text-xl">${title}</h3><span class="text-sm font-bold text-muted">${total} in ${days.length} days</span></div>
    <div class="mt-3 flex h-32 items-end gap-1">${days
      .map((d) => {
        const n = by.get(d) ?? 0;
        return `<div class="flex h-full flex-1 flex-col justify-end" title="${d}: ${n}"><div class="rounded-t-sm border-2 border-ink" style="height:${Math.max(n ? 6 : 0, (n / max) * 100)}%;background:var(--color-${color})"></div></div>`;
      })
      .join("")}</div>
    <div class="mt-1 flex justify-between font-mono text-[11px] text-muted"><span>${days[0]?.slice(5)}</span><span>${days.at(-1)?.slice(5)}</span></div></section>`;
}

function render(el: HTMLElement, d: Insights): void {
  const days = daysBetween(d.from, d.to);
  const guests = new Map(d.totals.map((t) => [t.event, t.guests]));
  const perDay = (event: string): Day[] => d.funnel.filter((f) => f.event === event).map((f) => ({ day: f.day, n: f.guests }));
  const top = guests.get("home_view") ?? 0;
  el.innerHTML = `
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
      ${tile(d.stats.players, "real players", "all time, humans only")}
      ${tile(d.stats.matches, "matches with a human")}
      ${tile(d.returning, "returning players", "played on 2 or more days")}
      ${tile(`${d.stats.multiHumanPct}%`, "matches with 2+ humans")}
      ${tile(d.stats.agentPops, "liquidations by AI agents")}
    </div>
    <section class="pop mt-6 rounded-2xl bg-card p-5">
      <h3 class="font-display text-2xl">Funnel, unique visitors ${d.from} to ${d.to}</h3>
      <ol class="mt-4 grid gap-2">${STEPS.map(([e, label], i) => {
        const n = guests.get(e) ?? 0;
        const prev = i ? (guests.get(STEPS[i - 1]![0]) ?? 0) : n;
        const pct = prev ? Math.round((n / prev) * 100) : 0;
        return `<li class="grid grid-cols-[14rem_1fr_7rem] items-center gap-3"><span class="font-bold">${label}</span>
          <div class="h-6 rounded-md border-2 border-ink bg-cream"><div class="h-full rounded-sm bg-safe" style="width:${top ? (n / top) * 100 : 0}%"></div></div>
          <span class="text-right font-mono text-sm tabular-nums">${n}${i ? ` <span class="text-muted">(${pct}%)</span>` : ""}</span></li>`;
      }).join("")}</ol>
      <p class="mt-3 text-sm text-muted">Each row counts different browsers that did it at least once; the % is from the row above. Pages: ${PAGES.map(([e, l]) => `${l} ${guests.get(e) ?? 0}`).join(", ")}.</p>
    </section>
    <div class="mt-6 grid gap-4 lg:grid-cols-2">
      ${bars("Visitors per day", days, d.visitors, "sky")}
      ${bars("Real players per day", days, d.players, "safe")}
      ${bars("Pressed Practice free", days, perDay("practice_click"), "warn")}
      ${bars("Finished a match", days, perDay("match_finished"), "safe")}
      ${bars("Matches with 2+ humans", days, d.multi, "agent")}
      ${bars("Paid matches", days, d.paid, "gold")}
    </div>`;
}

export const stats: Screen = (root) => {
  // Read the key once, then take it out of the address bar (kept for this tab only).
  const url = new URL(location.href);
  // #key=... never reaches a server log or a Referer; ?key= still works for old bookmarks.
  const frag = new URLSearchParams(url.hash.slice(1));
  const fromUrl = frag.get("key") ?? url.searchParams.get("key");
  if (fromUrl) {
    try {
      sessionStorage.setItem("margin.statsKey", fromUrl);
    } catch {
      /* private mode: the key lives only in memory for this visit */
    }
    url.searchParams.delete("key");
    frag.delete("key");
    const rest = frag.toString();
    history.replaceState(history.state, "", url.pathname + url.search + (rest ? `#${rest}` : ""));
  }
  let key = fromUrl;
  try {
    key ??= sessionStorage.getItem("margin.statsKey");
  } catch {
    /* ignore */
  }
  root.innerHTML = `<div class="paper-dots min-h-dvh text-ink">${header()}
    <main class="mx-auto max-w-6xl px-4 pb-16"><h1 class="font-display text-4xl">Stats</h1>
    <p class="mt-1 text-muted">Private. Anonymous counts only: no names, wallets or IPs are stored.</p>
    <div data-s=body class="mt-6"><p class="font-bold">Loading...</p></div></main></div>`;
  const body = root.querySelector<HTMLElement>("[data-s=body]")!;
  let gone = false;
  if (!key) {
    body.innerHTML = `<p class="font-bold">Nothing here.</p>`;
    return;
  }
  void fetch(`${ENDPOINT}/api/insights`, { cache: "no-store", headers: { "x-stats-key": key } })
    .then((r) => (r.ok ? (r.json() as Promise<Insights>) : Promise.reject(new Error(String(r.status)))))
    .then((d) => !gone && render(body, d))
    .catch(() => !gone && (body.innerHTML = `<p class="font-bold">Nothing here.</p>`));
  return () => void (gone = true);
};
