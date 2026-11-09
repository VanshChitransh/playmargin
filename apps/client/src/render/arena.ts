// The arena renderer: light agar-style floor with a grid that runs past the edge, a soft
// edge band, a red zone tint only once the zone shrinks, food, spikes, blobs,
// and a camera that follows my blob and zooms out as it grows. Reads one Frame per
// display frame from a source (synthetic now, interpolated server snapshots in U2).
import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type { Frame } from "../game/frame";
import { BlobSprite } from "./blob";
import { C, vivid } from "./colors";
import { spikeWouldRedden } from "./danger";
import { SPIKE_R, SpikeSprite, bakeSpikeTextures } from "./spike";
import { boostBlocked, boostPreview } from "../hud/logic";
import { FxLayer } from "./fx";
import { NitroFeel } from "./nitro";

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
  private view = VIEW_AT_START;

  async mount(root: HTMLElement, source: FrameSource, opts: { fps?: boolean; fit?: HTMLElement; view?: number } = {}): Promise<void> {
    await this.app.init({
      resizeTo: opts.fit ?? window,
      background: C.floor,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    root.appendChild(this.app.canvas);
    this.view = opts.view ?? VIEW_AT_START;
    this.bake();
    this.world.addChild(this.grid, this.zone, this.foodLayer, this.spikeLayer, this.blobLayer, this.preview, this.fx);
    this.app.stage.addChild(this.world);
    if (opts.fps) {
      this.fps = new Text({ text: "", style: { fontFamily: "JetBrains Mono", fontSize: 12, fill: C.muted } });
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

  /** Freeze the world picture for ms (effects keep moving). */
  hitStop(ms: number): void {
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
    if (meView) this.follow(meView.x, meView.y, meView.radius);
  }

  private drawZone(f: Frame): void {
    const z = f.match.zone;
    // The tint shows only once the zone is really closing (Squeeze), never in warm-up.
    if (f.match.phase !== "LIVE") this.zoneMaxR = 0;
    else this.zoneMaxR = Math.max(this.zoneMaxR, z.r);
    const shrinking = f.match.phase === "LIVE" && z.r < this.zoneMaxR - 1 && z.r < Math.hypot(f.arena.w, f.arena.h);
    const key = `${z.cx | 0},${z.cy | 0},${z.r | 0},${shrinking},${f.arena.w},${f.arena.h}`;
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    this.zone.clear();
    // agar.io edge: same grid on both sides, only a faint thin line marks the end.
    this.zone.rect(0, 0, f.arena.w, f.arena.h).stroke({ width: 2, color: C.edge, alpha: 0.9 });
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
  }

  private syncFood(f: Frame): void {
    const seen = new Set<number>();
    for (const fd of f.food) {
      seen.add(fd.id);
      let s = this.foods.get(fd.id);
      if (!s) {
        s = new Sprite(this.dot);
        s.anchor.set(0.5);
        s.tint = vivid(fd.id);
        this.foods.set(fd.id, s);
        this.foodLayer.addChild(s);
      }
      s.position.set(fd.x, fd.y);
      s.width = s.height = fd.r * 2 * (0.94 + 0.06 * Math.sin(this.lastT * 3 + fd.id));
    }
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
        !!me && Math.hypot(sp.x - me.x, sp.y - me.y) - me.radius - (sp.big ? SPIKE_R.big : SPIKE_R.small) < WARN_REACH;
      const danger = near && me!.state === "alive" && spikeWouldRedden(me!.equity, me!.owe, sp.big);
      s.update(sp.x, sp.y, sp.big, danger, tS);
    }
    prune(this.spikes, seen);
  }

  private syncBlobs(f: Frame, tS: number): void {
    const seen = new Set<string>();
    for (const v of f.blobs) {
      seen.add(v.id);
      const isMe = v.id === f.me;
      let s = this.blobs.get(v.id);
      if (!s) {
        s = new BlobSprite(v, isMe);
        this.blobs.set(v.id, s);
        this.blobLayer.addChild(s);
      }
      s.update(v, tS, isMe, this.zoom);
      s.zIndex = isMe ? 1e6 : v.radius; // small under big, me always on top
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

  private follow(x: number, y: number, r: number): void {
    const { width, height } = this.app.screen;
    const base = Math.max(width, height) / this.view;
    // Zoom out as I grow so a boosted blob still sees its threats (agar.io feel).
    const target = base * Math.min(1.2, Math.max(0.35, Math.pow(57 / Math.max(r, 1), 0.4)));
    this.zoom += (target - this.zoom) * 0.08;
    this.world.scale.set(this.zoom);
    this.world.position.set(width / 2 - x * this.zoom, height / 2 - y * this.zoom);
  }
}

function prune<K, V extends Container>(map: Map<K, V>, seen: Set<K>): void {
  for (const [k, v] of map) {
    if (!seen.has(k)) {
      v.destroy({ children: true });
      map.delete(k);
    }
  }
}
