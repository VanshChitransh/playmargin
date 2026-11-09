// The arena renderer: light agar-style floor with a grid that runs past the edge, a soft
// edge band, a red zone tint only once the zone shrinks, food, spikes, blobs,
// and a camera that follows my blob and zooms out as it grows. Reads one Frame per
// display frame from a source (synthetic now, interpolated server snapshots in U2).
import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type { Frame } from "../game/frame";
import { BlobSprite } from "./blob";
import { C, pellet } from "./colors";
import { spikeWouldRedden } from "./danger";
import { SpikeSprite, bakeSpikeTextures } from "./spike";
import { boostBlocked, boostPreview } from "../hud/logic";
import { FxLayer } from "./fx";
import { NitroFeel } from "./nitro";
import type { Shot } from "./director";
import { reducedMotion } from "./motion";
import { JUICE } from "./juice";

/** ~35 grid cells across the screen at start size (agar.io measured). */
const CELL = 60;
/** Grid drawn this far past the arena so the camera never shows a void. */
const BEYOND = 3000;
/** Spikes further than this from my edge never warn: "within reach" (RULES, Spikes). */
const WARN_REACH = 500;
/** World units across the LONG screen side at start size: a start blob is ~5.5% of it (agar.io). */
const VIEW_AT_START = 2100;

export type FrameSource = (nowMs: number) => Frame | null;

export class ArenaRenderer {
  readonly app = new Application();
  private world = new Container();
  private grid!: TilingSprite;
  private zone = new Graphics();
  private foodLayer = new Container();
  private spikeLayer = new Container();
  private blobLayer = new Container();
  private preview = new Graphics();
  readonly fx = new FxLayer();
  private frozenUntil = 0;
  private lastFrame: Frame | null = null;
  private lastT = 0;
  private foods = new Map<number, Sprite>();
  private foodBorn = new Map<number, number>();
  /** Called when MY blob eats a pellet (presentation: blip, squash, mote). */
  onPickup?: () => void;
  private lastBlip = 0;
  private spikes = new Map<number, SpikeSprite>();
  private blobs = new Map<string, BlobSprite>();
  private dot!: Texture;
  private spikeTex!: ReturnType<typeof bakeSpikeTextures>;
  private zoom = 1;
  private fps?: Text;
  private zoneKey = "";
  private zoneMaxR = 0;
  /** BOOST held right now (set by the play screen): drives the nitro feel. */
  held = false;
  private nitro = new NitroFeel();
  private lastDraw = 0;
  /** Spectator camera: where to look when there is no player blob (#/watch). */
  director?: (f: Frame, tS: number) => Shot | null;
  private cam: Shot | null = null;
  /** Boost camera: extra zoom-out (0..1 of BOOST_ZOOM_OUT), lead and kick offsets in screen px. */
  private bz = 0;
  private lead = { x: 0, y: 0 };
  private kick = { x: 0, y: 0 };
  private wasBoosting = false;
  private last: { x: number; y: number; h: number } | null = null;
  private view = VIEW_AT_START;
  private lastBlobT = 0;

  async mount(root: HTMLElement, source: FrameSource, opts: { fps?: boolean; fit?: HTMLElement; view?: number } = {}): Promise<void> {
    // Canvas text bakes whatever font is loaded at creation: wait for ours (a direct load of
    // #/watch drew names in a serif fallback otherwise). Never block on a font that fails.
    await Promise.race([
      Promise.all(["700 28px Rubik", "30px 'Lilita One'"].map((f) => document.fonts.load(f))).catch(() => {}),
      new Promise((ok) => setTimeout(ok, 1500)),
    ]);
    await this.app.init({
      resizeTo: opts.fit ?? window,
      background: C.floor,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    root.appendChild(this.app.canvas);
    // ?view=N zooms the camera in for recordings (world units across the long side).
    this.view = opts.view ?? (Number(new URLSearchParams(location.search).get("view")) || VIEW_AT_START);
    this.bake();
    this.world.addChild(this.grid, this.zone, this.foodLayer, this.spikeLayer, this.blobLayer, this.preview, this.fx);
    this.app.stage.addChild(this.world);
    if (opts.fps) {
      this.fps = new Text({ text: "", style: { fontFamily: ["JetBrains Mono", "monospace"], fontSize: 12, fill: C.muted } });
      this.fps.position.set(8, 8);
      this.app.stage.addChild(this.fps);
    }
    const t0 = performance.now();
    this.app.ticker.add(() => {
      const now = performance.now();
      const tS = (now - t0) / 1000;
      // Hit-stop: hold the last picture for a beat so my own pop lands (Juice it or lose it).
      const f = now < this.frozenUntil ? this.lastFrame : source(now);
      if (f) this.draw(f, tS);
      this.lastFrame = f;
      this.fx.tick(Math.min(0.05, tS - this.lastT));
      this.lastT = tS;
      if (this.fps) this.fps.text = `${Math.round(this.app.ticker.FPS)} fps`;
    });
  }

  /** My blob squashes when a REPAY lands. */
  squashMe(id: string): void {
    this.blobs.get(id)?.squash();
  }

  /** Freeze the world picture for ms (effects keep moving). */
  hitStop(ms: number): void {
    if (reducedMotion) return;
    this.frozenUntil = performance.now() + ms;
  }

  get zoomLevel(): number {
    return this.zoom;
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }

  private bake(): void {
    const cell = new Graphics()
      .rect(0, 0, CELL, CELL)
      .fill(C.floor)
      .moveTo(0, 0.5)
      .lineTo(CELL, 0.5)
      .moveTo(0.5, 0)
      .lineTo(0.5, CELL)
      .stroke({ width: 2, color: C.floorLine });
    this.grid = new TilingSprite({ texture: this.app.renderer.generateTexture(cell), width: 1, height: 1 });
    this.dot = this.app.renderer.generateTexture({
      // White body with a grey rim: the tint makes it one vivid colour with a darker edge.
      // Flat pellet, no outline (agar.io); the tint gives each one its colour.
      target: new Graphics().circle(0, 0, 16).fill(0xffffff),
      resolution: 2,
    });
    this.spikeTex = bakeSpikeTextures(this.app.renderer);
  }

  private draw(f: Frame, tS: number): void {
    const meView = f.blobs.find((b) => b.id === f.me);
    this.grid.position.set(-BEYOND, -BEYOND);
    this.grid.width = f.arena.w + BEYOND * 2;
    this.grid.height = f.arena.h + BEYOND * 2;
    this.drawZone(f);
    this.syncFood(f);
    this.syncSpikes(f, meView, tS);
    this.syncBlobs(f, tS);
    this.drawPreview(f, meView);
    const dt = Math.min(0.1, tS - this.lastDraw);
    this.lastDraw = tS;
    this.nitro.update(meView, meView && this.blobs.get(meView.id), f.match.phase, this.held, this.fx, this.zoom, dt);
    if (meView) this.boostCam(meView, f.match.phase === "LIVE" && this.held && (meView.fuel ?? 1) > 0.001, dt);
    if (meView) this.follow(meView.x, meView.y, meView.radius, dt);
    else this.direct(f, tS);
  }

  /** Smooth pan and zoom toward the director's shot, so cuts read as camera moves. */
  private direct(f: Frame, tS: number): void {
    const s = this.director?.(f, tS);
    if (!s) return;
    const c = (this.cam ??= { ...s });
    const k = 0.05;
    c.x += (s.x - c.x) * k;
    c.y += (s.y - c.y) * k;
    c.r += (s.r - c.r) * k;
    this.follow(c.x, c.y, c.r, 1 / 60);
  }

  private drawZone(f: Frame): void {
    const z = f.match.zone;
    // The tint shows only once the zone is really closing (Squeeze), never in warm-up.
    if (f.match.phase !== "LIVE") this.zoneMaxR = 0;
    else this.zoneMaxR = Math.max(this.zoneMaxR, z.r);
    const shrinking = f.match.phase === "LIVE" && z.r < this.zoneMaxR - 1 && z.r < Math.hypot(f.arena.w, f.arena.h);
    const key = `${z.cx | 0},${z.cy | 0},${z.r | 0},${shrinking},${f.arena.w},${f.arena.h},${this.zoom.toFixed(2)}`;
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    this.zone.clear();
    // agar.io edge: the floor past the wall is a shade darker and the edge is a soft thick line,
    // so a blob flattening there reads as hitting a wall.
    const out = Math.max(f.arena.w, f.arena.h) + BEYOND;
    this.zone
      .rect(-out, -out, f.arena.w + out * 2, f.arena.h + out * 2)
      .fill({ color: C.ink, alpha: JUICE.WALL_TINT_ALPHA })
      .rect(0, 0, f.arena.w, f.arena.h)
      .cut();
    if (shrinking) {
      const pad = Math.max(f.arena.w, f.arena.h);
      this.zone
        .rect(-pad, -pad, f.arena.w + pad * 2, f.arena.h + pad * 2)
        .fill({ color: C.liq, alpha: 0.12 })
        .circle(z.cx, z.cy, z.r)
        .cut()
        .circle(z.cx, z.cy, z.r)
        .stroke({ width: 4, color: C.liq, alpha: 0.7 });
    }
    this.zone.rect(0, 0, f.arena.w, f.arena.h).stroke({ width: JUICE.WALL_LINE_PX / this.zoom, color: C.ink, alpha: JUICE.WALL_LINE_ALPHA });
  }

  private syncFood(f: Frame): void {
    const seen = new Set<number>();
    const me = f.blobs.find((b) => b.id === f.me && b.state === "alive");
    for (const fd of f.food) {
      seen.add(fd.id);
      let s = this.foods.get(fd.id);
      if (!s) {
        s = new Sprite(this.dot);
        s.anchor.set(0.5);
        s.tint = pellet(fd.id);
        this.foodBorn.set(fd.id, this.lastT);
        this.foods.set(fd.id, s);
        this.foodLayer.addChild(s);
      }
      s.position.set(fd.x, fd.y);
      s.width = s.height = fd.r * 2 * (0.94 + 0.06 * Math.sin(this.lastT * 3 + fd.id));
      s.alpha = Math.min(1, (this.lastT - (this.foodBorn.get(fd.id) ?? 0)) / JUICE.PELLET_FADE_S);
    }
    // A pellet that vanished touching my edge is one I ate: give it a little feedback.
    if (me) {
      for (const [id, s] of this.foods) {
        if (seen.has(id) || Math.hypot(s.x - me.x, s.y - me.y) > me.radius + s.width / 2 + 12) continue;
        this.fx.mote(s.x, s.y, me.x, me.y, this.zoom);
        this.blobs.get(me.id)?.squash(JUICE.PICKUP_SQUASH, JUICE.PICKUP_SQUASH_MS);
        if (performance.now() - this.lastBlip > JUICE.PICKUP_MIN_GAP_MS) {
          this.lastBlip = performance.now();
          this.onPickup?.();
        }
      }
    }
    for (const id of this.foodBorn.keys()) if (!seen.has(id)) this.foodBorn.delete(id);
    prune(this.foods, seen);
  }

  private syncSpikes(f: Frame, me: Frame["blobs"][number] | undefined, tS: number): void {
    const seen = new Set<number>();
    for (const sp of f.spikes) {
      seen.add(sp.id);
      let s = this.spikes.get(sp.id);
      if (!s) {
        s = new SpikeSprite(this.spikeTex);
        this.spikes.set(sp.id, s);
        this.spikeLayer.addChild(s);
      }
      const near =
        !!me && Math.hypot(sp.x - me.x, sp.y - me.y) - me.radius - sp.r < WARN_REACH;
      const danger = near && me!.state === "alive" && spikeWouldRedden(me!.equity, me!.owe, sp.big);
      s.update(sp.x, sp.y, sp.r, sp.big, danger, tS);
    }
    prune(this.spikes, seen);
  }

  private syncBlobs(f: Frame, tS: number): void {
    const seen = new Set<string>();
    const dt = Math.min(0.1, Math.max(0, tS - this.lastBlobT));
    this.lastBlobT = tS;
    // Before GO blobs pass through each other, so nothing dents; drones never touch anyone.
    const live = f.match.phase !== "WARMUP" && f.match.phase !== "COUNTDOWN";
    const solid = live ? f.blobs.filter((b) => b.state === "alive" && b.kind !== "drone") : [];
    for (const v of f.blobs) {
      seen.add(v.id);
      const isMe = v.id === f.me;
      let s = this.blobs.get(v.id);
      if (!s) {
        s = new BlobSprite(v, isMe);
        this.blobs.set(v.id, s);
        this.blobLayer.addChild(s);
      }
      const boosting = isMe && this.held && f.match.phase === "LIVE" && (v.fuel ?? 1) > 0.001;
      // agar: cells overlap and the bigger one draws on top (me wins a tie), so only the
      // smaller blob dents, along the edge of the one above it.
      const over = solid.filter((o) => o.id !== v.id && above(o, v, f.me) && Math.hypot(o.x - v.x, o.y - v.y) < o.radius + v.radius);
      s.update(v, tS, isMe, this.zoom, !isMe && !live, boosting, { w: f.arena.w, h: f.arena.h, over: over.map((o) => ({ x: o.x, y: o.y, r: o.radius })), dt });
      s.zIndex = v.radius + (isMe ? 0.5 : 0);
    }
    this.blobLayer.sortableChildren = true;
    prune(this.blobs, seen);
  }

  /** Thin solid ring = my size after one BOOST tap; dotted ring = after every lit pip. */
  private drawPreview(f: Frame, me: Frame["blobs"][number] | undefined): void {
    this.preview.clear();
    const p = me && !boostBlocked(me, f.match) ? boostPreview(me) : null;
    if (!me || !p) return;
    this.preview.circle(me.x, me.y, p.next).stroke({ width: 2 / this.zoom, color: C.ink, alpha: 0.4 });
    if (p.max - p.next < 1) return;
    const n = 40;
    for (let i = 0; i < n; i += 2) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      this.preview.moveTo(me.x + Math.cos(a0) * p.max, me.y + Math.sin(a0) * p.max).arc(me.x, me.y, p.max, a0, a1);
    }
    this.preview.stroke({ width: 2 / this.zoom, color: C.ink, alpha: 0.25 });
  }

  /** Boost camera: a touch wider and leading the way while boosting, with one small kick on press. */
  private boostCam(me: Frame["blobs"][number], boosting: boolean, dt: number): void {
    const prev = this.last;
    const moved = prev ? Math.hypot(me.x - prev.x, me.y - prev.y) : 0;
    const h = prev && moved > 0.5 ? Math.atan2(me.y - prev.y, me.x - prev.x) : (prev?.h ?? 0);
    this.last = { x: me.x, y: me.y, h };
    const ease = (tau: number): number => 1 - Math.exp(-dt / tau);
    this.bz += ((boosting ? 1 : 0) - this.bz) * ease(boosting ? JUICE.BOOST_ZOOM_IN_TAU_S : JUICE.BOOST_ZOOM_BACK_TAU_S);
    if (reducedMotion) return;
    const lx = boosting ? Math.cos(h) * JUICE.BOOST_LEAD_PX : 0;
    const ly = boosting ? Math.sin(h) * JUICE.BOOST_LEAD_PX : 0;
    const k = ease(boosting ? JUICE.BOOST_ZOOM_IN_TAU_S : JUICE.BOOST_ZOOM_BACK_TAU_S);
    this.lead.x += (lx - this.lead.x) * k;
    this.lead.y += (ly - this.lead.y) * k;
    if (boosting && !this.wasBoosting) this.kick = { x: -Math.cos(h) * JUICE.BOOST_KICK_PX, y: -Math.sin(h) * JUICE.BOOST_KICK_PX };
    this.wasBoosting = boosting;
    const kd = 1 - ease(JUICE.KICK_TAU_S);
    this.kick = { x: this.kick.x * kd, y: this.kick.y * kd };
  }

  private follow(x: number, y: number, r: number, dt: number): void {
    const { width, height } = this.app.screen;
    const base = Math.max(width, height) / this.view;
    // agar.io: no zoom-out until full-BOOST size (r 89), then (89/r)^0.4, never under 0.6.
    const size = Math.max(JUICE.ZOOM_FLOOR, Math.pow(Math.min(JUICE.ZOOM_R0 / Math.max(r, 1), 1), JUICE.ZOOM_POW));
    const target = base * size * (1 - JUICE.BOOST_ZOOM_OUT * this.bz);
    this.zoom += (target - this.zoom) * (1 - Math.exp(-dt / JUICE.ZOOM_TAU_S));
    this.world.scale.set(this.zoom);
    const ox = this.lead.x + this.kick.x;
    const oy = this.lead.y + this.kick.y;
    this.world.position.set(width / 2 - ox - x * this.zoom, height / 2 - oy - y * this.zoom);
  }
}

/** Is blob a drawn on top of blob b? Bigger on top; my blob wins a tie. */
function above(a: Frame["blobs"][number], b: Frame["blobs"][number], me: string): boolean {
  return a.radius > b.radius || (a.radius === b.radius && (a.id === me || (b.id !== me && a.id > b.id)));
}

function prune<K, V extends Container>(map: Map<K, V>, seen: Set<K>): void {
  for (const [k, v] of map) {
    if (!seen.has(k)) {
      v.destroy({ children: true });
      map.delete(k);
    }
  }
}
