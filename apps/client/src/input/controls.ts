// Player input as Commands (never positions). Desktop: mouse steers, Space = BOOST,
// R = REPAY, E = cash out. Phone: nipplejs joystick on the left, buttons on the right.
// Sends at most 30/s; taps are edge events carried by the next command; any blur or
// tab switch sends a zero command at once so nothing stays held (EDGE-CASES: stuck BOOST).
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
  private taps = { boost: false, repay: false, cashout: false };
  private seq = 0;
  private lastSent = 0;
  private timer: number;
  private off: Array<() => void> = [];

  constructor(root: HTMLElement, private send: (cmd: InputCmd) => void) {
    const layer = document.createElement("div");
    layer.className = "pointer-events-none fixed inset-0 select-none";
    layer.innerHTML = `
      <div data-zone class="pointer-events-auto absolute inset-y-0 left-0 w-1/2 ${this.touch ? "" : "hidden"}"></div>
      <div class="absolute right-0 bottom-0 flex flex-col items-end gap-3 p-4 pr-[max(16px,env(safe-area-inset-right))] pb-[max(16px,env(safe-area-inset-bottom))] ${this.touch ? "" : "hidden"}">
        <button data-tap="cashout" class="pointer-events-auto btn btn-circle size-16 btn-accent hidden">CASH</button>
        <button data-tap="repay" class="pointer-events-auto btn btn-circle size-16 btn-outline">REPAY</button>
        <button data-tap="boost" class="pointer-events-auto btn btn-circle size-22 btn-primary">BOOST</button>
      </div>`;
    root.appendChild(layer);
    const q = (t: Tap): HTMLButtonElement => layer.querySelector(`[data-tap=${t}]`)!;
    this.els = { boost: q("boost"), repay: q("repay"), cashout: q("cashout") };
    for (const t of ["boost", "repay", "cashout"] as const) {
      // pointerdown, not click: answers on touch-down instead of ~100 ms later on release.
      this.listen(this.els[t], "pointerdown", (e) => {
        e.preventDefault();
        this.tap(t);
      });
    }
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
      if (e.repeat) return; // holding Space must not spam BOOST: one press, one pip
      const t: Tap | null = e.code === "Space" ? "boost" : e.code === "KeyR" ? "repay" : e.code === "KeyE" ? "cashout" : null;
      if (!t) return;
      e.preventDefault();
      this.tap(t);
    });
  }

  private joystick(zone: HTMLElement): void {
    const stick = nipplejs.create({ zone, mode: "dynamic", color: "#EEF2FF", size: 110 });
    // nipplejs y points up; screen and world y point down.
    stick.on("move", (e) => (this.dir = { x: e.data.vector.x, y: -e.data.vector.y }));
    stick.on("end", () => (this.dir = { x: 0, y: 0 }));
    this.off.push(() => stick.destroy());
  }

  private tap(t: Tap): void {
    this.taps[t] = true;
    this.flush(false);
  }

  /** Zero everything and tell the server now, so a lost focus never leaves input held. */
  private release(): void {
    this.dir = { x: 0, y: 0 };
    this.taps = { boost: false, repay: false, cashout: false };
    this.lastSent = 0;
    this.flush(false);
  }

  private flush(fromTimer: boolean): void {
    const now = performance.now();
    if (!fromTimer && now - this.lastSent < SEND_MS) return; // the interval picks it up within 33 ms
    this.lastSent = now;
    this.send({ seq: ++this.seq, dirX: this.dir.x, dirY: this.dir.y, ...this.taps });
    this.taps = { boost: false, repay: false, cashout: false };
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
