// #/watch: a spectator view for trailers and B-roll. A director camera follows the action
// (a pop that just happened, a red blob about to be popped, a cash-out, else the biggest blob)
// with smooth pans. It spectates a real server match (S2 /api/watch: the busiest public room,
// or an agents-only one), and only if the server cannot be reached a local match of labelled
// bots on the real rules. /?clean=1#/watch hides the HUD and keeps
// only the stamp moments. Real gameplay only: nothing here is scripted or staged.
import type { GameEventMsg } from "@margin/core";
import type { Frame } from "../game/frame";
import { LocalMatch } from "../game/local";
import { Hud } from "../hud/hud";
import { displayName } from "../hud/logic";
import { MatchConnection } from "../net/client";
import { ArenaRenderer } from "../render/arena";
import { Director } from "../render/director";
import type { Screen } from "../router";

interface Feed {
  frameAt(now: number): Frame | null;
  onEvent(cb: (e: GameEventMsg) => void): () => void;
  leave?(): void;
  onCommander?: (r: string | null) => void;
}

const JOIN_TIMEOUT_MS = 2500;

async function liveFeed(): Promise<Feed | null> {
  const conn = new MatchConnection();
  const timeout = new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), JOIN_TIMEOUT_MS));
  try {
    await Promise.race([conn.spectate(), timeout]);
    return conn;
  } catch (e) {
    console.warn("watch: no live room, local bots", e);
    conn.leave();
    return null;
  }
}

const localFeed = (): LocalMatch => new LocalMatch({ seed: (Math.random() * 1e9) | 0, withMe: false, bots: 12, warmupS: 3 });

export const watch: Screen = (root) => {
  const clean = new URLSearchParams(location.search).has("clean");
  const arena = new ArenaRenderer();
  const director = new Director();
  arena.director = (f, tS) => director.shot(f, tS);
  const dummy = (): HTMLButtonElement => document.createElement("button");
  const hud = clean ? null : new Hud(root, { boost: dummy(), repay: dummy(), cashout: dummy() }, () => {}, { coach: false });
  const label = document.createElement("div");
  label.className = "tag pointer-events-none fixed bottom-3 left-3 text-ink/60";
  if (!clean) root.appendChild(label);
  const stamp = document.createElement("div");
  stamp.className = "pointer-events-none fixed inset-x-0 top-[28%] z-10 grid place-items-center";
  root.appendChild(stamp);

  let feed: Feed | null = null;
  let last: Frame | null = null;
  let left = false;
  let mounted = false;
  let off = (): void => {};
  let endedAt = 0;

  const showStamp = (word: string, who: string): void => {
    stamp.innerHTML = `<div class="text-center"><div class="stamp inline-block rounded-box border-[6px] border-liq bg-paper/90 px-6 py-2 font-display text-6xl text-liq">${word}</div>
      <div class="tag mt-2 text-ink">${who.replace(/[&<>"']/g, "")}</div></div>`;
    setTimeout(() => stamp.firstElementChild?.remove(), 1400);
  };

  const attach = (f: Feed, live: boolean): void => {
    off();
    feed = f;
    endedAt = 0;
    label.textContent = live ? "Live match, spectating" : "Server unreachable: local bots on the real rules";
    f.onCommander = (r) => hud?.commander(r);
    off = f.onEvent((e) => {
      director.event(e, last, performance.now() / 1000);
      const name = (id: string): string => {
        const b = last?.blobs.find((x) => x.id === id);
        return b ? displayName(b) : id;
      };
      if (e.type === "pop") showStamp("LIQUIDATED", e.keeper || !e.by ? `${name(e.victim)}, closed by the vault` : `${name(e.victim)} by ${name(e.by)}`);
      else if (e.type === "eat") showStamp("EATEN", `${name(e.victim)} by ${name(e.by)}`);
      else if (e.type === "cashedOut") showStamp("CASHED OUT", name(e.blob));
    });
  };

  void arena
    .mount(root, (now) => {
      const raw = feed?.frameAt(now) ?? null;
      if (!raw) return null;
      const f: Frame = { ...raw, me: "" }; // a spectator has no blob: the director drives the camera
      last = f;
      hud?.update(f, now);
      // After the bell, move on to the next match a few seconds later so recording never stalls.
      if (f.match.phase === "ENDED") {
        endedAt ||= now;
        if (now - endedAt > 4000 && !switching) next();
      }
      if (import.meta.env.DEV) Object.assign(window, { __frame: f });
      return f;
    })
    .then(() => {
      mounted = true;
      if (left) arena.destroy();
    });

  let switching = false;
  const next = (): void => {
    switching = true;
    const old = feed;
    void liveFeed().then((f) => {
      switching = false;
      if (left) return f?.leave?.();
      old?.leave?.();
      attach(f ?? localFeed(), !!f);
    });
  };
  next();

  return () => {
    left = true;
    off();
    feed?.leave?.();
    hud?.destroy();
    if (mounted) arena.destroy();
  };
};
