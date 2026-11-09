// HUD v1 in HTML over the canvas (numbers stay crisp, CSS does the motion). Reads one
// Frame per display frame and writes the DOM only when a value changes. Corners hold the
// clock and leaderboard; everything about MY money sits next to the BOOST button.
import { R, type BlobView } from "@margin/core";
import type { Frame } from "../game/frame";
import type { ControlsEls } from "../input/controls";
import { boostBlocked, cashoutOpen, displayName, elapsedS, interestPerS, phaseName, pipGradient, ranking } from "./logic";
import "./hud.css";
import { isMuted, play as sfx, setMuted } from "../audio";

const LB_MS = 1000 / R.LEADERBOARD_HZ;
const ROW_PX = 22;
const C = { gold: "#F5B83D", liq: "#FF3D5A", dim: "#1A2742", paper: "#EEF2FF" };

export class Hud {
  private el: HTMLElement;
  private q = <T extends HTMLElement>(s: string): T => this.el.querySelector<T>(`[data-h=${s}]`)!;
  private last = new Map<string, string>();
  private lbAt = 0;
  private bannerKey = "";
  private pipRing: HTMLElement;
  private recharge: number[] = []; // ms timestamps each spent pip relights
  private prevPips: number = R.BOOST_PIPS;
  private lastBeat = 0;

  constructor(root: HTMLElement, private els: ControlsEls, private onCashoutWindow: (open: boolean) => void) {
    this.el = document.createElement("div");
    this.el.className = "pointer-events-none fixed inset-0 select-none font-sans text-paper";
    this.el.innerHTML = `
      <div class="absolute top-0 inset-x-0 flex flex-col items-center pt-[max(10px,env(safe-area-inset-top))]">
        <div class="flex items-center gap-2 rounded-box bg-navy/80 px-3 py-1">
          <span data-h=phase class="text-xs font-medium tracking-widest text-muted"></span>
          <span data-h=clock class="num text-xl font-bold"></span>
        </div>
        <div data-h=banner class="mt-3 font-display text-3xl tracking-wide drop-shadow"></div>
      </div>
      <div class="absolute right-0 top-0 p-3 pr-[max(12px,env(safe-area-inset-right))] pt-[max(12px,env(safe-area-inset-top))]">
        <ol data-h=lb class="relative w-44 rounded-box bg-navy/70 p-2 text-sm" style="height:${R.LEADERBOARD_TOP * ROW_PX + 16}px"></ol>
        <div data-h=myrank class="mt-1 hidden w-44 rounded-box bg-navy/70 px-2 py-1 text-sm"></div>
      </div>
      <div data-h=center class="absolute inset-x-0 top-[14%] grid place-items-center text-center"></div>
      <div data-h=frame class="call-frame"></div>
      <button data-h=mute class="tag pointer-events-auto absolute left-0 top-0 m-3 mt-[max(12px,env(safe-area-inset-top))] rounded-field bg-navy/80 px-2 py-1 text-muted"></button>
      <div data-h=call class="tag absolute inset-x-0 bottom-28 hidden text-center"><span class="rounded-field bg-liq px-3 py-1 text-paper">Margin call: tap REPAY to get out</span></div>
      <div data-h=money class="absolute bottom-0 right-28 flex flex-col items-end gap-1 p-4 pb-[max(20px,env(safe-area-inset-bottom))]">
        <span data-h=owe class="num hidden rounded-field bg-navy/80 px-2 py-0.5 text-gold"></span>
        <span data-h=drain class="num hidden text-xs text-liq"></span>
      </div>`;
    root.appendChild(this.el);
    const mute = this.q("mute");
    const label = (): void => void (mute.textContent = isMuted() ? "Sound off" : "Sound on");
    label();
    mute.addEventListener("click", () => {
      setMuted(!isMuted());
      label();
    });
    this.pipRing = document.createElement("span");
    this.pipRing.className = "pip-ring";
    els.boost.classList.add("relative");
    els.boost.appendChild(this.pipRing);
  }

  destroy(): void {
    this.el.remove();
    this.pipRing.remove();
  }

  update(f: Frame, now: number): void {
    const m = f.match;
    const me = f.blobs.find((b) => b.id === f.me);
    this.clock(f);
    this.center(f);
    if (now - this.lbAt >= LB_MS) {
      this.lbAt = now;
      this.leaderboard(f);
    }
    if (!me) return;
    this.pips(me, now, boostBlocked(me, m));
    const ring = me.state === "alive" && m.phase === "LIVE" ? me.ring : "green";
    this.set("ring", ring, () => {
      // Android buzz on the way into red (iOS has no vibrate; the frame and label still show).
      if (ring === "red" && this.last.get("ringPrev") !== "red") navigator.vibrate?.([70, 50, 70]);
      this.last.set("ringPrev", ring);
      this.q("frame").dataset.ring = ring;
      this.q("call").classList.toggle("hidden", ring !== "red");
      this.els.repay.classList.toggle("urgent", ring === "red");
    });
    if (ring === "red" && now - this.lastBeat > 900) {
      this.lastBeat = now;
      sfx("beat");
    }
    const cash = cashoutOpen(me, m);
    this.set("cash", String(cash), () => this.onCashoutWindow(cash));
    this.els.repay.classList.toggle("blocked", me.owe <= 0 || m.phase !== "LIVE");
    const owe = Math.round(me.owe);
    this.set("owe", String(owe), () => {
      const o = this.q("owe");
      o.textContent = `owe ${owe}`;
      o.classList.toggle("hidden", owe <= 0);
    });
    const drain = interestPerS(me.owe, m.rateTier, f.rateBps);
    const txt = drain.toFixed(drain < 1 ? 2 : 1); // small loans still show a moving number
    this.set("drain", txt, () => {
      const d = this.q("drain");
      d.textContent = `−${txt}/s`;
      d.classList.toggle("hidden", drain <= 0);
    });
  }

  private clock(f: Frame): void {
    const m = f.match;
    const e = elapsedS(m);
    const label = m.phase === "LIVE" ? phaseName(e) : m.phase === "ENDED" ? "FINAL" : m.phase === "COUNTDOWN" ? "GET READY" : "WARM-UP";
    const t = m.phase === "LIVE" || m.phase === "WARMUP" ? m.timeLeftS : m.phase === "COUNTDOWN" ? R.MATCH_S : 0;
    this.set("clock", `${label}${t}`, () => {
      this.q("phase").textContent = label;
      this.q("clock").textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    });
    if (m.phase !== "LIVE") return;
    // One-line banners at the moments the rules change (inspiration: Rocket League "30 SECONDS").
    const key = e >= R.BOOST_LOCKOUT_S ? "LOCK" : e >= R.LAST_CALL_S ? "LAST CALL" : phaseName(e);
    if (key === this.bannerKey) return;
    const first = this.bannerKey === "";
    this.bannerKey = key;
    if (first && key === "GROW") return; // GO already owns the screen
    const text: Record<string, [string, string]> = {
      GROW: ["EAT TO GROW", C.paper],
      HUNT: ["HUNT", C.paper],
      SQUEEZE: ["SQUEEZE: ZONE CLOSING", C.liq],
      "LAST CALL": ["LAST CALL: 5 S TO BOOST", C.gold],
      LOCK: ["BOOST LOCKED: REPAY OR CASH OUT", C.liq],
    };
    const [msg, color] = text[key]!;
    this.flash(this.q("banner"), msg, "banner", color);
  }

  private center(f: Frame): void {
    const m = f.match;
    const c = this.q("center");
    if (m.phase === "WARMUP") {
      const n = f.blobs.filter((b) => b.kind !== "drone").length;
      this.set("center", `W${n}/${m.timeLeftS}`, () => {
        c.innerHTML = `<div><div class="num font-display text-7xl">${n}/${R.ROOM_SIZE}</div>
          <div class="mt-1 text-muted">Finding players · starts in <span class="num">${m.timeLeftS}</span></div>
          <div class="mt-2 text-sm text-muted">Warm up: steer around. BOOST unlocks at GO.</div></div>`;
      });
    } else if (m.phase === "COUNTDOWN") {
      this.set("center", `C${m.timeLeftS}`, () => {
        this.flash(c, String(m.timeLeftS), "punch", C.paper, "font-display text-9xl num");
        sfx("tick");
      });
    } else if (m.phase === "LIVE" && elapsedS(m) < 1) {
      this.set("center", "GO", () => {
        this.flash(c, "GO!", "punch", C.gold, "font-display text-8xl");
        sfx("go");
      });
    } else {
      this.set("center", "", () => (c.innerHTML = ""));
    }
  }

  private leaderboard(f: Frame): void {
    const ranked = ranking(f.blobs);
    const top = ranked.slice(0, R.LEADERBOARD_TOP);
    const row = (b: BlobView, rank: number): string => {
      const mine = b.id === f.me;
      const name = esc(displayName(b));
      return `<div class="flex h-full items-center justify-between gap-2 rounded px-1 ${mine ? "bg-grid font-bold" : ""}">
        <span class="truncate ${b.kind === "agent" ? "text-agent" : ""}"><span class="num text-muted">${rank}</span> ${name}</span>
        <span class="num text-gold">${Math.round(b.equity)}</span></div>`;
    };
    // Rows are keyed by blob id and placed with translateY, so a rank change slides the
    // same element (CSS transition) instead of re-creating it.
    const lb = this.q("lb");
    const keep = new Set<string>();
    top.forEach((b, i) => {
      keep.add(b.id);
      let li = lb.querySelector<HTMLElement>(`[data-id="${b.id}"]`);
      if (!li) {
        li = document.createElement("li");
        li.dataset.id = b.id;
        li.style.cssText = `position:absolute;left:8px;right:8px;top:8px;height:${ROW_PX}px;transition:transform 300ms ease`;
        li.style.transform = `translateY(${i * ROW_PX}px)`;
        lb.appendChild(li);
      }
      li.style.transform = `translateY(${i * ROW_PX}px)`;
      const html = row(b, i + 1);
      if (li.dataset.html !== html) {
        li.dataset.html = html;
        li.innerHTML = html;
      }
    });
    lb.querySelectorAll<HTMLElement>("li").forEach((li) => keep.has(li.dataset.id!) || li.remove());
    const myRank = ranked.findIndex((b) => b.id === f.me);
    const mine = this.q("myrank");
    const show = myRank >= R.LEADERBOARD_TOP;
    mine.classList.toggle("hidden", !show);
    if (show) mine.innerHTML = row(ranked[myRank]!, myRank + 1);
  }

  private pips(me: BlobView, now: number, blocked: boolean): void {
    const max = R.BOOST_PIPS;
    const lit = Math.min(max, me.pips);
    // The server only sends the lit count: start a 3 s refill per spent pip on our side.
    if (lit < this.prevPips) for (let i = lit; i < this.prevPips; i++) this.recharge.push(now + R.BOOST_RECHARGE_S * 1000);
    if (lit > this.prevPips) this.recharge.splice(0, lit - this.prevPips);
    this.prevPips = lit;
    this.recharge = this.recharge.slice(-(max - lit));
    const spent = [...this.recharge].sort((a, b) => a - b).map((t) => 1 - Math.max(0, t - now) / (R.BOOST_RECHARGE_S * 1000));
    const fills = Array.from({ length: max }, (_, i) => (i < lit ? 1 : (spent[i - lit] ?? 0)));
    this.pipRing.style.background = pipGradient(fills, blocked ? "#8391B3" : C.gold, C.dim);
    this.els.boost.classList.toggle("blocked", blocked);
  }

  /** Re-run a CSS animation on el with new text. */
  private flash(el: HTMLElement, text: string, anim: string, color: string, cls = ""): void {
    el.innerHTML = "";
    const s = document.createElement("div");
    s.className = `${anim} ${cls}`;
    s.style.color = color;
    s.textContent = text;
    el.appendChild(s);
  }

  /** Run write() only when key changed for this slot: no DOM churn at 60 fps. */
  private set(slot: string, key: string, write: () => void): void {
    if (this.last.get(slot) === key) return;
    this.last.set(slot, key);
    write();
  }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
