// Player input as Commands (never positions). Desktop: mouse steers, Space = BOOST,
// R = REPAY, E = cash out. Phone: nipplejs joystick on the left, buttons on the right.
// Sends at most 30/s. BOOST is HELD state (hold-to-nitro): true in every command while Space
// or the button is down. REPAY and cash-out stay edge taps. Any blur or tab switch sends a zero
// command at once so nothing stays held (EDGE-CASES: stuck BOOST, plus the 250 ms server expiry).
import nipplejs from "nipplejs";
import type { InputCmd } from "@margin/core";
import { dirFromPointer } from "./dir";

const SEND_MS = 1000 / 30;
type Tap = "boost" | "repay" | "cashout";

export interface ControlsEls {
  boost: HTMLButtonElement;
  repay: HTMLButtonElement;
  cashout: HTMLButtonElement;
}

export class Controls {
  // Touch laptops get both control sets; keyboard and mouse are always attached.
  readonly touch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  readonly els: ControlsEls;
  private dir = { x: 0, y: 0 };
  private taps = { repay: false, cashout: false };
  private boostHeld = false;
  /** Fired when BOOST starts or stops being held (sound, nitro feel). */
  onHold?: (on: boolean) => void;
  private seq = 0;
  private lastSent = 0;
  private timer: number;
  private off: Array<() => void> = [];

  constructor(root: HTMLElement, private send: (cmd: InputCmd) => void) {
    // Laptop judges see the keys on the buttons themselves; phones don't need them.
    const key = (k: string): string => (this.touch ? "" : `<kbd class="kbd kbd-xs mt-0.5 opacity-70">${k}</kbd>`);
    const layer = document.createElement("div");
    layer.className = "pointer-events-none fixed inset-0 select-none";
    layer.innerHTML = `
      <div data-zone class="pointer-events-auto absolute inset-y-0 left-0 w-1/2 ${this.touch ? "" : "hidden"}"></div>
      <div class="absolute right-0 bottom-0 flex flex-col items-end gap-3 p-4 pr-[max(16px,env(safe-area-inset-right))] pb-[max(16px,env(safe-area-inset-bottom))]">
        <button data-tap="cashout" class="pointer-events-auto btn btn-circle size-16 btn-accent hidden flex-col gap-0">CASH${key("E")}</button>
        <button data-tap="repay" class="pointer-events-auto btn btn-circle size-16 flex-col gap-0 border-2 border-ink bg-navy text-paper">REPAY${key("R")}</button>
        <button data-tap="boost" class="pointer-events-auto btn btn-circle size-22 flex-col gap-0 border-4 border-ink bg-gold text-ink hover:bg-gold">BOOST${key("SPACE")}</button>
      </div>`;
    root.appendChild(layer);
    const q = (t: Tap): HTMLButtonElement => layer.querySelector(`[data-tap=${t}]`)!;
    this.els = { boost: q("boost"), repay: q("repay"), cashout: q("cashout") };
    for (const t of ["boost", "repay", "cashout"] as const) {
      // pointerdown, not click: answers on touch-down instead of ~100 ms later on release.
      this.listen(this.els[t], "pointerdown", (e) => {
        e.preventDefault();
        if (t === "boost") {
          this.els.boost.setPointerCapture(e.pointerId); // a finger sliding off still counts until lifted
          return this.hold(true);
        }
        this.tap(t);
      });
    }
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) this.listen(this.els.boost, type, () => this.hold(false));
    if (this.touch) this.joystick(layer.querySelector<HTMLElement>("[data-zone]")!);
    this.desktop();
    this.listen(window, "blur", () => this.release());
    this.listen(document, "visibilitychange", () => document.hidden && this.release());
    this.off.push(() => layer.remove());
    this.timer = window.setInterval(() => this.flush(true), SEND_MS);
  }

  /** Show the cash-out button only inside its window (phone; E on desktop is always mapped). */
  setCashoutVisible(on: boolean): void {
    this.els.cashout.classList.toggle("hidden", !on);
  }

  destroy(): void {
    clearInterval(this.timer);
    this.release();
    this.off.forEach((f) => f());
  }

  private desktop(): void {
    this.listen(window, "pointermove", (e) => {
      if (e.pointerType === "mouse") this.dir = dirFromPointer(e.clientX, e.clientY, innerWidth, innerHeight);
    });
    this.listen(window, "keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) this.hold(true);
        return;
      }
      if (e.repeat) return; // REPAY and cash-out are one press, one tap
      const t: Tap | null = e.code === "KeyR" ? "repay" : e.code === "KeyE" ? "cashout" : null;
      if (!t) return;
      e.preventDefault();
      this.tap(t);
    });
    this.listen(window, "keyup", (e) => e.code === "Space" && this.hold(false));
  }

  private joystick(zone: HTMLElement): void {
    // A faint base shows where to put a thumb; it goes away on the first touch (nipplejs then
    // draws the real stick wherever the thumb lands).
    const hint = document.createElement("div");
    hint.className = "pointer-events-none absolute bottom-[18%] left-[18%] grid size-28 place-items-center rounded-full border-4 border-ink/25 bg-ink/5";
    hint.innerHTML = `<div class="size-12 rounded-full border-4 border-ink/30 bg-paper/60"></div><span class="tag absolute -bottom-7 text-ink/50">Drag to steer</span>`;
    zone.appendChild(hint);
    zone.addEventListener("pointerdown", () => hint.remove(), { once: true });
    const stick = nipplejs.create({ zone, mode: "dynamic", color: "#0D1424", size: 110 });
    // nipplejs y points up; screen and world y point down.
    stick.on("move", (e) => (this.dir = { x: e.data.vector.x, y: -e.data.vector.y }));
    stick.on("end", () => (this.dir = { x: 0, y: 0 }));
    this.off.push(() => stick.destroy());
  }

  /** Nitro on or off; the change goes out at once, then every 33 ms while held. */
  private hold(on: boolean): void {
    if (this.boostHeld === on) return;
    this.boostHeld = on;
    this.els.boost.classList.toggle("holding", on);
    this.onHold?.(on);
    this.lastSent = 0;
    this.flush(false);
  }

  private tap(t: Exclude<Tap, "boost">): void {
    // Answer the press locally at once (< 100 ms rule); the server's result follows.
    this.els[t].animate([{ transform: "scale(0.86)" }, { transform: "scale(1)" }], { duration: 140, easing: "ease-out" });
    this.taps[t] = true;
    this.flush(false);
  }

  /** Zero everything and tell the server now, so a lost focus never leaves input held. */
  private release(): void {
    this.dir = { x: 0, y: 0 };
    this.taps = { repay: false, cashout: false };
    if (this.boostHeld) this.onHold?.(false);
    this.boostHeld = false;
    this.els.boost.classList.remove("holding");
    this.lastSent = 0;
    this.flush(false);
  }

  private flush(fromTimer: boolean): void {
    const now = performance.now();
    if (!fromTimer && now - this.lastSent < SEND_MS) return; // the interval picks it up within 33 ms
    this.lastSent = now;
    this.send({ seq: ++this.seq, dirX: this.dir.x, dirY: this.dir.y, boost: this.boostHeld, ...this.taps });
    this.taps = { repay: false, cashout: false };
  }

  private listen<K extends keyof (WindowEventMap & DocumentEventMap)>(
    t: Window | Document | HTMLElement,
    type: K,
    fn: (e: (WindowEventMap & DocumentEventMap)[K]) => void,
  ): void {
    t.addEventListener(type, fn as EventListener);
    this.off.push(() => t.removeEventListener(type, fn as EventListener));
  }
}
