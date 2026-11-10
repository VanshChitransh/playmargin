// HUD v1 in HTML over the canvas (numbers stay crisp, CSS does the motion). Reads one
// Frame per display frame and writes the DOM only when a value changes. Corners hold the
// clock and leaderboard; everything about MY money sits next to the BOOST button.
import { R, type BlobView } from "@margin/core";
import type { Frame } from "../game/frame";
import type { ControlsEls } from "../input/controls";
import { boostBlocked, cashoutOpen, outsideZone, displayName, elapsedS, interestPerS, phaseName, fuelGradient, fuelOf, ranking } from "./logic";
import "./hud.css";
import { isMuted, play as sfx, setMuted } from "../audio";
import { coachMarks, type Coach } from "./coach";
import { JUICE } from "../render/juice";
import { reducedMotion } from "../render/motion";

const LB_MS = 1000 / R.LEADERBOARD_HZ;
const ROW_PX = 30;
// Arcade Paper: fuel is green (safe to borrow), the empty track is the paper shade, blocked is muted.
const C = { gold: "#F5B83D", liq: "#E5484D", safe: "#38D96B", track: "#DDD3BE", muted: "#A9A3B8", paper: "#FFF6E6" };
const SPEAKER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/>`;


export class Hud {
  private el: HTMLElement;
  private q = <T extends HTMLElement>(s: string): T => (this.el.querySelector<T>(`[data-h=${s}]`) ?? document.querySelector<T>(`[data-h=${s}]`))!;
  private last = new Map<string, string>();
  private lbAt = 0;
  private bannerKey = "";
  private pipRing: HTMLElement;
  private lastBeat = 0;
  private tapHinted = false;
  private calmUntil = 0;
  private shownFuel = 1;
  private refill: { from: number; at: number } | null = null;
  private wasDry = false;

  private coach: Coach;
  /** #/watch: a spectator sees who is in the arena and when it starts, never player tips. */
  private spectator: boolean;
  held = false;
  /** Offline practice against local bots: never word it like a real lobby. */
  offline = false;
  /** Private room host tapped START. */
  onStart: () => void = () => {};

  constructor(root: HTMLElement, private els: ControlsEls, private onCashoutWindow: (open: boolean) => void, opts: { coach?: boolean; spectator?: boolean } = {}) {
    this.spectator = opts.spectator === true;
    this.el = document.createElement("div");
    // invisible until the first frame: no empty clock, leaderboard or pills while connecting
    this.el.className = "hud pointer-events-none invisible fixed inset-0 select-none font-sans text-ink";
    this.el.innerHTML = `
      <div class="absolute top-0 inset-x-0 flex flex-col items-center pt-[max(10px,env(safe-area-inset-top))]">
        <div class="hud-timer self-start max-sm:ml-[56px] sm:self-center">
          <span data-h=phase class="hud-phase"></span>
          <span data-h=clock class="hud-clock"></span>
        </div>
        <div data-h=banner class="mt-3 px-3 text-center font-display text-3xl tracking-wide max-sm:mt-40 max-sm:text-2xl"></div>
      </div>
      <div class="absolute right-0 top-0 p-3 pr-[max(12px,env(safe-area-inset-right))] pt-[max(12px,env(safe-area-inset-top))]">
        <div class="hud-lb">
          <h4><span>EQUITY</span><small data-h=lbtop></small></h4>
          <ol data-h=lb class="relative transition-[height] duration-300" style="height:${ROW_PX + 8}px"></ol>
          <div data-h=myrank class="hidden"></div>
        </div>
      </div>
      <div data-h=center class="absolute inset-x-0 top-[14%] grid place-items-center text-center"></div>
      <div data-h=frame class="call-frame"></div>
      <div data-h=zoneframe class="zone-frame hidden"></div>
      <div data-h=zonecall class="absolute inset-x-0 bottom-40 hidden text-center"><span class="hud-call">OUT OF THE ZONE: get back in</span></div>
      <span data-h=off class="hud-pill absolute left-3 top-[62px] mt-[max(0px,env(safe-area-inset-top))] hidden text-[11px]">offline practice</span>
      <p data-h=cmd style="display:none" class="hud-cmd absolute left-0 top-[58px] m-3 hidden max-w-[min(22rem,60vw)] max-sm:max-w-[calc(100vw-208px)] max-sm:text-[11px]"></p>
      <button data-h=mute class="hud-pill pointer-events-auto absolute left-0 top-0 m-2.5 mt-[max(10px,env(safe-area-inset-top))] cursor-pointer"></button>
      <div data-h=tap class="pointer-events-none absolute left-1/2 top-[calc(50%+64px)] hidden -translate-x-1/2"><span class="hud-hint">HOLD R</span></div>
      <div data-h=call class="absolute inset-x-0 bottom-28 hidden text-center"><span class="hud-call">MARGIN CALL: hold REPAY to get out</span></div>
      <div data-h=pay class="pointer-events-none absolute hidden -translate-x-1/2 -translate-y-full"><span data-h=payt class="block whitespace-nowrap font-display text-5xl tabular-nums text-gold" style="-webkit-text-stroke:6px var(--color-ink);paint-order:stroke fill"></span></div>
      <div data-h=money class="hud-money pointer-events-none hidden">
        <span data-h=owe class="hud-owe"></span>
        <span data-h=drain class="hud-drain hidden"></span>
      </div>`;
    root.appendChild(this.el);
    const mute = this.q("mute");
    const label = (): void =>
      void (mute.innerHTML = isMuted() ? `${SPEAKER}<path d="m22 9-6 6M16 9l6 6"/></svg><span>Sound off</span>` : `${SPEAKER}<path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg><span>Sound on</span>`);
    mute.setAttribute("aria-label", "Toggle sound");
    label();
    mute.addEventListener("click", () => {
      setMuted(!isMuted());
      label();
    });
    this.pipRing = document.createElement("span");
    this.pipRing.className = "pip-ring";
    els.boost.classList.add("relative");
    els.boost.appendChild(this.pipRing);
    // The loan chip rides on top of REPAY (v1 "owe 3"): the debt sits on the button that clears it.
    const money = this.q("money");
    els.repay.classList.add("relative"); // the badge is positioned against REPAY itself
    els.repay.appendChild(money);
    const noCoach = opts.coach === false || innerWidth < 640 || innerHeight < 500; // no room beside a small dock
    this.coach = noCoach ? { update: () => {}, close: () => {} } : coachMarks(root, (t) => els[t]);
  }

  destroy(): void {
    clearInterval(this.stream);
    this.el.remove();
    this.pipRing.remove();
    this.q("money")?.remove();
    this.coach.close();
  }

  update(f: Frame, now: number): void {
    this.el.classList.remove("invisible");
    this.q("off").classList.toggle("max-sm:inline", this.offline);
    const m = f.match;
    const me = f.blobs.find((b) => b.id === f.me);
    this.clock(f);
    this.center(f);
    if (now - this.lbAt >= LB_MS) {
      this.lbAt = now;
      this.leaderboard(f);
    }
    this.coach.update(m.phase, elapsedS(m), (me?.owe ?? 0) > 0, !!me && me.ring !== "green");
    if (!me) return;
    this.fuel(me, boostBlocked(me, m));
    // Right after a server-confirmed save the frame snaps off and the heartbeat cuts, even if
    // the next snapshot is a beat late.
    const raw = me.state === "alive" && m.phase === "LIVE" ? me.ring : "green";
    const ring = now < this.calmUntil && raw === "red" ? "yellow" : raw;
    this.set("ring", ring, () => {
      // Android buzz on the way into red (iOS has no vibrate; the frame and label still show).
      const prev = this.last.get("ringPrev");
      if (ring === "red" && prev !== "red") navigator.vibrate?.([70, 50, 70]);
      else if (ring === "yellow" && prev === "green") navigator.vibrate?.(25); // a tick: margin is getting thin
      this.last.set("ringPrev", ring);
      this.q("frame").dataset.ring = ring;
      this.q("call").classList.toggle("hidden", ring !== "red");
      this.els.repay.classList.toggle("urgent", ring === "red");
    });
    // Heartbeat tempo follows health: 1.0 (just red) beats slowly, 0.9 (the vault's line) races.
    const health = me.owe > 0 ? ((me.equity + me.owe) * 0.8) / me.owe : 2;
    const k = Math.max(0, Math.min(1, (1 - health) / 0.1));
    const beatMs = JUICE.BEAT_SLOW_MS - (JUICE.BEAT_SLOW_MS - JUICE.BEAT_FAST_MS) * k;
    if (ring === "red" && !this.tapHinted) this.tapHint();
    if (ring !== "red") this.q("tap").classList.add("hidden"); // out of red, the hint has done its job
    if (ring === "red" && now - this.lastBeat > beatMs) {
      this.lastBeat = now;
      sfx("beat");
    }
    // Outside the circle the zone drains mass every second: say so on screen, not just in the number.
    const out = outsideZone(me, m);
    this.q("zoneframe").classList.toggle("hidden", !out);
    this.q("zonecall").classList.toggle("hidden", !out || ring === "red"); // the margin call wins the slot
    const cash = cashoutOpen(me, m);
    this.set("cash", String(cash), () => this.onCashoutWindow(cash));
    this.els.repay.classList.toggle("blocked", me.owe <= 0 || m.phase !== "LIVE");
    if (this.oweNow > 0.5 && me.owe <= 0.5 && me.state === "alive" && m.phase === "LIVE") this.paidOff(now);
    this.oweNow = me.owe;
    this.repayFill();
    this.payCounter(now);
    const owe = Math.round(me.owe);
    this.set("owe", String(owe), () => {
      const o = this.q("owe");
      o.textContent = `owe ${owe}`;
      this.q("money").classList.toggle("hidden", owe <= 0);
      this.q("money").classList.toggle("flex", owe > 0);
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
    const t = m.phase === "LIVE" || (m.phase === "WARMUP" && !f.lobby) ? m.timeLeftS : m.phase === "COUNTDOWN" ? R.MATCH_S : 0;
    const lobby = m.phase === "WARMUP" && !!f.lobby; // private room: no timer, the host starts it
    this.set("clock", `${label}${t}${lobby}`, () => {
      this.q("phase").textContent = lobby ? "LOBBY" : label;
      this.q("phase").dataset.p = lobby ? "WAIT" : label.split(" ")[0]!; // chip colour: GROW green, HUNT yellow, SQUEEZE red
      this.q("clock").textContent = lobby ? "" : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
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
    this.flash(this.q("banner"), msg, "banner", color, "outlined");
  }

  private center(f: Frame): void {
    const m = f.match;
    const c = this.q("center");
    if (m.phase === "WARMUP" && f.lobby) {
      // Private room (PUBG custom room): no timer, no agents; the host starts once a friend is in.
      const n = f.blobs.filter((b) => b.kind === "human").length;
      const ready = f.lobby.host && n >= 2;
      this.set("center", `P${n}/${f.lobby.host}`, () => {
        const line = !f.lobby!.host ? "Waiting for the host to start" : ready ? "Everyone in? Start when ready" : "Waiting for friends · send them the link";
        c.innerHTML = `<div class="hud-lobby-top"><div class="outlined font-display text-7xl tabular-nums text-paper">${n}/${R.ROOM_SIZE}</div>
          <div class="mt-1 font-semibold text-ink">${line}</div>
          ${f.lobby!.host ? `<button data-h=start ${ready ? "" : "disabled"} class="pop pointer-events-auto mt-3 rounded-box px-6 py-3 font-display text-2xl ${ready ? "pop-press cursor-pointer bg-safe text-ink" : "cursor-not-allowed bg-cream text-muted"}">${ready ? "START MATCH" : "START: needs 1 friend"}</button>` : ""}
          </div><div class="hud-lobby-hints">${this.hints()}</div>`;
        c.querySelector("[data-h=start]")?.addEventListener("click", (e) => {
          (e.currentTarget as HTMLButtonElement).disabled = true;
          this.onStart();
        });
      });
    } else if (m.phase === "WARMUP" && this.spectator) {
      // Agents join at the 3-2-1, so an empty warm-up is "next match", not "0/12 players".
      const n = f.blobs.filter((b) => b.kind !== "drone").length;
      this.set("center", `S${n}/${m.timeLeftS}`, () => {
        const who = n ? `${n} ${n === 1 ? "player" : "players"} in the arena · ` : "";
        c.innerHTML = `<div class="hud-lobby-top"><div class="outlined font-display text-6xl text-paper">WATCHING</div>
          <div class="mt-1 font-semibold text-ink">${who}${n ? "starts" : "Next match starts"} in <span class="num">${m.timeLeftS}</span> s</div></div>`;
      });
    } else if (m.phase === "WARMUP") {
      const n = f.blobs.filter((b) => b.kind !== "drone").length;
      this.set("center", `W${n}/${m.timeLeftS}`, () => {
        c.innerHTML = `<div class="hud-lobby-top"><div class="outlined font-display text-7xl tabular-nums text-paper">${n}/${R.ROOM_SIZE}</div>
          <div class="mt-1 font-semibold text-ink">${this.offline ? "Offline practice" : "Finding players"} · starts in <span class="num">${m.timeLeftS}</span></div>
          </div><div class="hud-lobby-hints">${this.hints()}</div>`;
      });
    } else if (m.phase === "COUNTDOWN") {
      this.set("center", `C${m.timeLeftS}`, () => {
        this.flash(c, String(m.timeLeftS), "punch", C.paper, "outlined font-display text-9xl tabular-nums");
        sfx("tick");
      });
    } else if (m.phase === "LIVE" && elapsedS(m) < 1) {
      this.set("center", "GO", () => {
        this.flash(c, "GO!", "punch", C.gold, "outlined font-display text-8xl");
        sfx("go");
      });
    } else {
      this.set("center", "", () => (c.innerHTML = ""));
    }
  }

  private leaderboard(f: Frame): void {
    const ranked = ranking(f.blobs);
    const rows = innerWidth < 640 || innerHeight < 500 ? 3 : R.LEADERBOARD_TOP; // phones (and landscape phones): top 3 + my rank
    const top = ranked.slice(0, rows);
    const row = (b: BlobView, rank: number): string => {
      const mine = b.id === f.me;
      const bot = b.kind !== "human"; // agents and drones get the robot glyph instead of the emoji
      const name = esc(bot ? displayName(b).replace(/\u{1F916}/gu, "").trim() : displayName(b));
      return `<div class="hud-row${mine ? " me" : ""}"><span class="r">${rank}</span>
        <span class="nm">${bot ? '<i class="bot" aria-label="AI agent"></i>' : ""}<span class="truncate">${name}</span></span>
        <span class="eq">${Math.round(b.equity)}</span></div>`;
    };
    // Rows are keyed by blob id and placed with translateY, so a rank change slides the
    // same element (CSS transition) instead of re-creating it. Rows are opaque and the one
    // climbing rides on top, so two rows swapping never show text through each other. Only a
    // small reorder slides: when someone enters or leaves (popped, cashed, overtaken) every row
    // snaps to its slot at once, so a vacated slot never shows as a blank row mid-slide.
    const lb = this.q("lb");
    const keep = new Set<string>();
    const had = [...lb.querySelectorAll<HTMLElement>("li")].map((li) => li.dataset.id).sort().join();
    // A row jumping two or more slots also opens a half-row hole mid-slide, so only one-slot
    // swaps animate (two rows trading places always cover both slots).
    const jump = top.some((b, i) => {
      const at = lb.querySelector<HTMLElement>(`[data-id="${b.id}"]`)?.dataset.i;
      return at !== undefined && Math.abs(Number(at) - i) > 1;
    });
    const snap = jump || had !== top.map((b) => b.id).sort().join();
    top.forEach((b, i) => {
      keep.add(b.id);
      let li = lb.querySelector<HTMLElement>(`[data-id="${b.id}"]`);
      if (!li) {
        li = document.createElement("li");
        li.dataset.id = b.id;
        li.style.cssText = `position:absolute;left:6px;right:6px;top:4px;height:${ROW_PX}px`;
        lb.appendChild(li);
      }
      li.style.transition = snap ? "none" : "transform 250ms ease";
      const was = Number(li.dataset.i ?? i);
      li.style.zIndex = i < was ? "2" : "1";
      li.dataset.i = String(i);
      li.style.transform = `translateY(${i * ROW_PX}px)`;
      const html = row(b, i + 1);
      if (li.dataset.html !== html) {
        li.dataset.html = html;
        li.innerHTML = html;
      }
    });
    lb.querySelectorAll<HTMLElement>("li").forEach((li) => keep.has(li.dataset.id!) || li.remove());
    lb.style.height = `${Math.max(1, top.length) * ROW_PX + 8}px`; // sized to its rows, no empty box
    lb.closest<HTMLElement>(".hud-lb")!.classList.toggle("hidden", top.length === 0); // nobody in yet: no empty card
    this.set("lbtop", String(rows), () => (this.q("lbtop").textContent = `top ${rows}`));
    const myRank = ranked.findIndex((b) => b.id === f.me);
    const mine = this.q("myrank");
    const show = myRank >= rows;
    mine.classList.toggle("hidden", !show);
    if (show) mine.innerHTML = row(ranked[myRank]!, myRank + 1);
  }

  /** The fuel ring around BOOST: drains while held, refills as REPAY or eating raise equity. */
  private fuel(me: BlobView, blocked: boolean): void {
    const target = fuelOf(me);
    const now = performance.now();
    // Draining shows at once; a refill (REPAY or eating raised equity) eases in with a shimmer.
    if (target > this.shownFuel + 0.01 && !this.refill) {
      this.refill = { from: this.shownFuel, at: now };
      this.pipRing.classList.remove("shimmer");
      void this.pipRing.offsetWidth;
      this.pipRing.classList.add("shimmer");
    }
    if (this.refill) {
      const k = Math.min(1, (now - this.refill.at) / JUICE.FUEL_REFILL_MS);
      this.shownFuel = this.refill.from + (target - this.refill.from) * (1 - (1 - k) ** 3);
      if (k >= 1) this.refill = null;
    } else this.shownFuel = target;
    this.pipRing.style.background = fuelGradient(this.shownFuel, blocked ? C.muted : C.safe, C.track, 1, 0); // one tank: hold-to-nitro has no pips
    // The tank running dry: the ring flashes grey twice (once per emptying), the button greys.
    const dry = target <= 0.01;
    if (dry && !this.wasDry) {
      this.pipRing.classList.remove("empty");
      void this.pipRing.offsetWidth;
      this.pipRing.classList.add("empty");
    }
    if (!dry) this.pipRing.classList.remove("empty");
    this.wasDry = dry;
    this.els.boost.classList.toggle("blocked", blocked);
  }


  /** Warm-up teaching, no numbers: one line per rule. MARGIN plays on a laptop only (phones get the
   *  "plays on a laptop" card), so the words are always keys, even on a touch-screen laptop. */
  private hints(): string {
    const lines = ["Hold SPACE to boost (you borrow)", "Red? You can't eat. Hold R to repay", "Cash out from 0:45"];
    return `<ul class="mx-auto flex max-w-sm flex-col items-center gap-1.5 text-sm">${lines
      .map((l) => `<li class="hud-hint-line">${l}</li>`)
      .join("")}<li class="text-xs font-semibold text-muted">Try BOOST now: it is free practice until GO.</li></ul>`;
  }

  /** Edge speed lines while BOOST burns: started by the press, faded over 250 ms on release. */
  speedLines(on: boolean): void {
    if (reducedMotion) return;
    let box = this.el.querySelector<HTMLElement>("[data-h=lines]");
    if (!box) {
      box = document.createElement("div");
      box.dataset.h = "lines";
      box.className = "speed-lines pointer-events-none absolute inset-0 overflow-hidden";
      box.style.transition = `opacity ${JUICE.SPEED_LINE_FADE_MS}ms ease-out`;
      const n = JUICE.SPEED_LINES;
      box.innerHTML = Array.from({ length: n }, (_, i) => {
        // Spread around the edges, pointing at the centre; only the outer ~18% of the screen.
        const a = (i / n) * Math.PI * 2 + (i % 2) * 0.15;
        const x = 50 + Math.cos(a) * 62;
        const y = 50 + Math.sin(a) * 62;
        const deg = (a * 180) / Math.PI;
        return `<span style="left:${x}%;top:${y}%;transform:translate(-50%,-50%) rotate(${deg}deg);animation-delay:${(i % 4) * 60}ms"></span>`;
      }).join("");
      this.el.appendChild(box);
    }
    box.style.opacity = on ? String(JUICE.SPEED_LINE_ALPHA) : "0";
  }

  /** A save landed: drop the red kit now. */
  saved(now: number): void {
    this.calmUntil = now + JUICE.SAVE_CALM_MS;
    this.lastBeat = now + JUICE.SAVE_CALM_MS;
    this.q("frame").dataset.ring = "yellow";
    this.q("call").classList.add("hidden");
    this.q("tap").classList.add("hidden");
    this.els.repay.classList.remove("urgent");
  }

  private oweNow = 0;
  private oweAtPress = 0;
  private stream = 0;
  private repaying = false;
  private paidUntil = 0;
  /** Where my blob is on screen (px), so coins and the counter start at it, not at the centre. */
  anchor: () => { x: number; y: number; r: number } | null = () => null;

  /** Held REPAY: a dense coin stream into the owe badge, a gold fill on the button, and one
   *  big owe counter over my blob ticking down (replaces a flurry of small minus numbers). */
  repayHold(on: boolean): void {
    clearInterval(this.stream);
    this.repaying = on;
    this.oweAtPress = on ? this.oweNow : 0;
    this.repayFill();
    this.payCounter();
    if (!on || reducedMotion) return;
    this.stream = window.setInterval(() => {
      if (this.oweNow <= 0) return;
      for (let i = 0; i < JUICE.REPAY_STREAM_COINS; i++) this.coin(i * 15);
    }, JUICE.REPAY_STREAM_MS);
  }

  /** Share of the debt paid since the press: 0 just pressed, 1 cleared. */
  repayProgress(): number {
    return this.oweAtPress > 0 ? Math.max(0, Math.min(1, 1 - this.oweNow / this.oweAtPress)) : 0;
  }

  private repayFill(): void {
    const p = Math.round(this.repayProgress() * 100);
    this.els.repay.style.backgroundImage = this.oweAtPress > 0 ? `linear-gradient(to top, var(--color-gold) ${p}%, transparent ${p}%)` : "";
  }

  /** The big counter over my blob: "owe N" while held, then PAID OFF for a beat at zero. */
  private payCounter(now = performance.now()): void {
    const box = this.q("pay");
    const paid = now < this.paidUntil;
    const on = paid || (this.repaying && this.oweNow > 0);
    box.classList.toggle("hidden", !on);
    if (!on) return;
    const a = this.anchor() ?? { x: innerWidth / 2, y: innerHeight / 2, r: 40 };
    box.style.left = `${a.x}px`;
    box.style.top = `${a.y - a.r - 12}px`;
    if (!paid) this.q("payt").textContent = `owe ${Math.ceil(this.oweNow)}`;
  }

  /** Debt hit zero: PAID OFF pops over my blob with a cash-register chord. */
  private paidOff(now: number): void {
    this.paidUntil = now + JUICE.PAID_OFF_MS;
    const t = this.q("payt");
    t.textContent = "PAID OFF";
    t.classList.remove("punch");
    void t.offsetWidth; // restart the animation
    t.classList.add("punch");
    sfx("paid");
    navigator.vibrate?.(30);
    if (!reducedMotion) for (let i = 0; i < JUICE.PAID_OFF_COINS; i++) this.coin(i * 20);
  }

  /** A quick REPAY press: a few gold coins fly from my blob (screen centre) into the owe badge. */
  coinsToOwe(): void {
    if (reducedMotion) return;
    for (let i = 0; i < JUICE.REPAY_COINS; i++) this.coin(i * 40);
  }

  private coin(delay: number): void {
    const to = this.q("owe").getBoundingClientRect();
    if (!to.width) return;
    const c = document.createElement("span");
    c.className = "pointer-events-none fixed z-20 size-3 rounded-full border-2 border-ink bg-gold";
    const from = this.anchor() ?? { x: innerWidth / 2, y: innerHeight / 2, r: 30 };
    const spread = Math.min(from.r, 60);
    c.style.left = `${from.x + (Math.random() - 0.5) * spread}px`;
    c.style.top = `${from.y + (Math.random() - 0.5) * spread}px`;
    document.body.appendChild(c);
    const dx = to.left + to.width / 2 - parseFloat(c.style.left);
    const dy = to.top + to.height / 2 - parseFloat(c.style.top);
    c.animate([{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0.4 }], {
      duration: JUICE.COIN_FLY_MS,
      delay,
      easing: "cubic-bezier(0.5, 0, 0.8, 0.4)",
      fill: "both",
    }).onfinish = () => c.remove();
  }

  /** Once per match, the first time I go red: point at the one button that saves me. */
  private tapHint(): void {
    this.tapHinted = true;
    const t = this.q("tap");
    t.classList.remove("hidden");
    setTimeout(() => t.classList.add("hidden"), JUICE.TAP_HINT_MS);
  }

  /** The agents' commander plan, shown so spectators see what the AI is up to. Null hides it. */
  commander(text: string | null): void {
    const c = this.q("cmd");
    // The clamp sits on an inner span: clamped on the padded box, half a 4th line peeked out below.
    const t = c.querySelector("span") ?? c.appendChild(document.createElement("span"));
    t.textContent = text ? `Commander: ${text}` : "";
    c.classList.toggle("hidden", !text);
    c.style.display = text ? "" : "none"; // belt and braces: no display rule can beat this
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
