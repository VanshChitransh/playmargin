// Spikes: agar "virus" look, a green sawtooth with a darker rim, in two sizes (damage
// depends on the player, not the spike). Pulses red with a warning sign only when a hit
// would turn THIS player red (RULES.html, Spikes). Textures are baked once and shared.
import { Container, Graphics, Sprite, Text, Texture, type Renderer } from "pixi.js";
import { C } from "./colors";

export const SPIKE_R = { small: 18, big: 30 } as const;
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

  update(x: number, y: number, big: boolean, danger: boolean, tS: number): void {
    this.position.set(x, y);
    const r = big ? SPIKE_R.big : SPIKE_R.small;
    this.sprite.texture = danger ? this.tex.red : this.tex.grey;
    this.sprite.width = this.sprite.height = r * 2 * (danger ? 1.25 : 1);
    this.sprite.rotation = tS * 0.15;
    this.warn.visible = danger;
    if (danger) this.alpha = 0.75 + 0.25 * Math.sin(tS * 8 * Math.PI);
    else this.alpha = 1;
  }
}
