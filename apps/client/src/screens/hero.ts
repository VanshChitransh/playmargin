// The home page's live arena: a bots-only match on the real rules, filmed by the spectator
// director. Its own module, loaded on idle by landing.ts, so pixi is not in the first-load bundle.
import { LocalMatch } from "../game/local";
import { ArenaRenderer } from "../render/arena";
import { Director } from "../render/director";
import type { Frame } from "../game/frame";

/** Mount the hero arena into box; returns its cleanup. */
export function mountHero(box: HTMLElement): () => void {
  const arena = new ArenaRenderer();
  // Nobody is followed: the spectator director films the best action (a pop, a red blob with a
  // hunter near, a chase) and eases between shots. Following one bot left the shot dead whenever
  // that bot went quiet.
  const director = new Director();
  arena.director = (f, tS) => director.shot(f, tS);
  let last: Frame | null = null;
  const hero = (): LocalMatch => {
    const m = newHero();
    m.onEvent((e) => director.event(e, last, performance.now() / 1000));
    return m;
  };
  let match = hero();
  let left = false;
  let mounted = false;
  void arena
    .mount(
      box,
      (now) => {
        // A fresh match at the bell, or when fewer than 3 blobs are left to watch.
        let f = match.frameAt(now);
        if (f.match.phase === "ENDED" || f.blobs.filter((b) => b.state === "alive").length < 3) f = (match = hero()).frameAt(now);
        last = { ...f, me: "" };
        return last;
      },
      { fit: box, view: 1200 },
    )
    .then(() => {
      mounted = true;
      if (left) arena.destroy();
    });
  return () => {
    left = true;
    if (mounted) arena.destroy();
  };
}

// Greedy bots (hero only): same engine and rules, but half the bots over-borrow, so red rings and
// liquidations show up in the first seconds instead of almost never.
const newHero = (): LocalMatch => new LocalMatch({ seed: (Math.random() * 1e9) | 0, withMe: false, bots: 10, warmupS: 0, greedy: true });
