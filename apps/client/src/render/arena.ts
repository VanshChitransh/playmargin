// The arena renderer: neon grid, zone with a red tint outside, food, spikes, blobs,
// and a camera that follows my blob and zooms out as it grows. Reads one Frame per
// display frame from a source (synthetic now, interpolated server snapshots in U2).
import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type { Frame } from "../game/frame";
import { BlobSprite } from "./blob";
import { C } from "./colors";
import { spikeWouldRedden } from "./danger";
import { SPIKE_R, SpikeSprite, bakeSpikeTextures } from "./spike";

const CELL = 64;
/** Spikes further than this from my edge never warn: "within reach" (RULES, Spikes). */
const WARN_REACH = 500;
/** World px visible across the short screen side at start size. */
const VIEW_AT_START = 900;

export type FrameSource = (nowMs: number) => Frame | null;

export class ArenaRenderer {
  readonly app = new Application();
  private world = new Container();
  private grid!: TilingSprite;
  private zone = new Graphics();
  private foodLayer = new Container();
  private spikeLayer = new Container();
  private blobLayer = new Container();
  private foods = new Map<number, Sprite>();
  private spikes = new Map<number, SpikeSprite>();
  private blobs = new Map<string, BlobSprite>();
  private dot!: Texture;
  private spikeTex!: ReturnType<typeof bakeSpikeTextures>;
  private zoom = 1;
  private fps?: Text;
  private zoneKey = "";

  async mount(root: HTMLElement, source: FrameSource, opts: { fps?: boolean } = {}): Promise<void> {
    await this.app.init({
      resizeTo: window,
      background: C.ink,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    root.appendChild(this.app.canvas);
    this.bake();
    this.world.addChild(this.grid, this.zone, this.foodLayer, this.spikeLayer, this.blobLayer);
    this.app.stage.addChild(this.world);
    if (opts.fps) {
      this.fps = new Text({ text: "", style: { fontFamily: "JetBrains Mono", fontSize: 12, fill: C.muted } });
      this.fps.position.set(8, 8);
      this.app.stage.addChild(this.fps);
    }
    const t0 = performance.now();
    this.app.ticker.add(() => {
      const now = performance.now();
      const f = source(now);
      if (f) this.draw(f, (now - t0) / 1000);
      if (this.fps) this.fps.text = `${Math.round(this.app.ticker.FPS)} fps`;
    });
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }

  private bake(): void {
    const cell = new Graphics()
      .rect(0, 0, CELL, CELL)
      .fill(C.ink)
      .moveTo(0, 0)
      .lineTo(CELL, 0)
      .moveTo(0, 0)
      .lineTo(0, CELL)
      .stroke({ width: 1, color: C.grid });
    this.grid = new TilingSprite({ texture: this.app.renderer.generateTexture(cell), width: 1, height: 1 });
    this.dot = this.app.renderer.generateTexture({
      target: new Graphics().circle(0, 0, 16).fill(C.paper),
      resolution: 2,
    });
    this.spikeTex = bakeSpikeTextures(this.app.renderer);
  }

  private draw(f: Frame, tS: number): void {
    const meView = f.blobs.find((b) => b.id === f.me);
    this.grid.width = f.arena.w;
    this.grid.height = f.arena.h;
    this.drawZone(f);
    this.syncFood(f);
    this.syncSpikes(f, meView, tS);
    this.syncBlobs(f, tS);
    if (meView) this.follow(meView.x, meView.y, meView.radius);
  }

  private drawZone(f: Frame): void {
    const z = f.match.zone;
    const key = `${z.cx | 0},${z.cy | 0},${z.r | 0}`;
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    const pad = Math.max(f.arena.w, f.arena.h);
    this.zone
      .clear()
      .rect(-pad, -pad, f.arena.w + pad * 2, f.arena.h + pad * 2)
      .fill({ color: C.liq, alpha: 0.14 })
      .circle(z.cx, z.cy, z.r)
      .cut()
      .circle(z.cx, z.cy, z.r)
      .stroke({ width: 4, color: C.liq, alpha: 0.7 })
      .rect(0, 0, f.arena.w, f.arena.h)
      .stroke({ width: 3, color: C.muted, alpha: 0.5 });
  }

  private syncFood(f: Frame): void {
    const seen = new Set<number>();
    for (const fd of f.food) {
      seen.add(fd.id);
      let s = this.foods.get(fd.id);
      if (!s) {
        s = new Sprite(this.dot);
        s.anchor.set(0.5);
        s.tint = C.muted;
        this.foods.set(fd.id, s);
        this.foodLayer.addChild(s);
      }
      s.position.set(fd.x, fd.y);
      s.width = s.height = fd.r * 2;
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
      s.update(v, tS, isMe);
      s.zIndex = isMe ? 1e6 : v.radius; // small under big, me always on top
    }
    this.blobLayer.sortableChildren = true;
    prune(this.blobs, seen);
  }

  private follow(x: number, y: number, r: number): void {
    const { width, height } = this.app.screen;
    const base = Math.min(width, height) / VIEW_AT_START;
    // Zoom out as I grow so a boosted blob still sees its threats (agar.io feel).
    const target = base * Math.min(1.2, Math.max(0.45, Math.pow(57 / Math.max(r, 1), 0.45)));
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
