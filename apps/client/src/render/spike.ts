// Spikes: agar "virus" look, a green sawtooth with a darker rim, in two sizes (damage
// depends on the player, not the spike). Pulses red with a warning sign only when a hit
// would turn THIS player red (RULES.html, Spikes). Textures are baked once and shared.
import { Container, Graphics, Sprite, Text, Texture, type Renderer } from "pixi.js";
import { C } from "./colors";
import { reducedMotion } from "./motion";

const POINTS = 18;

/** Bake the grey and red spike textures once per renderer. */
export function bakeSpikeTextures(renderer: Renderer): { grey: Texture; red: Texture } {
  const make = (color: number, thick: boolean): Texture => {
    const g = new Graphics();
    const pts: number[] = [];
    for (let i = 0; i < POINTS * 2; i++) {
      const a = (Math.PI * i) / POINTS;
      const r = i % 2 ? 0.86 : 1;
      pts.push(Math.cos(a) * r * 32, Math.sin(a) * r * 32);
    }
    // Brand rule: no glows. Danger reads as colour plus a thick ink outline and the warning sign.
    g.poly(pts).fill({ color }).stroke({ width: thick ? 6 : 4, color: thick ? 0x070a12 : C.virusLine, join: "round" });
    return renderer.generateTexture({ target: g, resolution: 2 });
  };
  return { grey: make(C.virus, false), red: make(C.liq, true) };
}

export class SpikeSprite extends Container {
  private sprite: Sprite;
  private warn = new Text({ text: "⚠", style: { fontSize: 16, fill: C.paper } });

  constructor(private tex: { grey: Texture; red: Texture }) {
    super();
    this.sprite = new Sprite(tex.grey);
    this.sprite.anchor.set(0.5);
    this.warn.anchor.set(0.5);
    this.addChild(this.sprite, this.warn);
  }

  /** r is the core hitbox: drawn at exactly that size. Big spikes (harder hit) read darker. */
  update(x: number, y: number, r: number, big: boolean, danger: boolean, tS: number): void {
    this.position.set(x, y);
    this.sprite.texture = danger ? this.tex.red : this.tex.grey;
    this.sprite.tint = danger || !big ? 0xffffff : 0x9ccf9c;
    this.sprite.width = this.sprite.height = r * 2;
    this.sprite.rotation = reducedMotion ? 0 : tS * 0.15;
    this.warn.visible = danger;
    if (danger && !reducedMotion) this.alpha = 0.75 + 0.25 * Math.sin(tS * 8 * Math.PI);
    else this.alpha = 1;
  }
}
