// How it plays: one tall section with a pinned two-column frame. Scroll (or a tap on a step)
// picks the step, and one example match card plays that step's moment up close. The script is
// story-scene.ts, the canvas is story-draw.ts. Ported from research/margin/ui/drafts (agent 2).
import { LEAD, LOOP, TOAST, healthFactor, ringOf, scene } from "./story-scene";
import { StoryPainter } from "./story-draw";

const STEPS: [string, string, string][] = [
  ["Start small", "Everyone spawns at 80 mass and no debt. Equity is mass minus debt.", "safe"],
  ["Borrow to grow", "Hold <kbd>Space</kbd>. The vault lends you up to 2.5x your equity.", "gold"],
  ["Hunt", "Bigger eats smaller. Your equity grows, not just your size.", "safe"],
  ["The vault charges", "Interest eats mass every second. A spike takes a bite.", "warn"],
  ["Red is food", "Owe more than you can cover and one touch pops you. The popper takes 8%.", "liq"],
  ["Or repay at the top", "Hold <kbd>R</kbd> at your peak. The loan clears in 0.8 s. You keep 140.", "safe"],
];
const N = STEPS.length;
const pad = (i: number): string => String(i + 1).padStart(2, "0");

const html = `<section class="how" id="how" aria-label="How it plays">
  <div class="how-pin"><div class="how-frame">
    <div class="how-left">
      <div class="how-kicker">/ How it plays</div>
      <h2 class="how-h2">One loan.<br>Ninety seconds.</h2>
      <p class="how-lead">Follow one blob through a whole match. Scroll, or tap a step.</p>
      <ol class="how-steps">${STEPS.map(([t, s, dot], i) => `<li><button data-i="${i}"><span class="hn">${pad(i)}</span><span class="hb"><span class="ht">${t}</span><span class="hs">${s}</span></span><i class="hdot ${dot}"></i></button><span class="hbar"><i></i></span></li>`).join("")}</ol>
    </div>
    <div class="how-right">
      <span class="br tl"></span><span class="br tr"></span><span class="br bl"></span><span class="br brr"></span>
      <div class="how-card" data-card>
        <div class="hc-top"><span class="hc-room"><i></i>Room 7 · 12 players</span><span class="hc-clock" data-clock>0:08</span><span class="hc-ex">Example</span></div>
        <div class="hc-toast" data-toast><span class="hc-ico" data-ico>●</span><span><b data-t1>You spawned</b><small data-t2>80 mass, no debt</small></span><em>now</em></div>
        <div class="hc-arena"><canvas aria-label="An example match, step by step" role="img"></canvas><div class="hc-stamp">LIQUIDATED</div><div class="hc-rew">Rewind to 0:24</div></div>
        <div class="hc-pos">
          <div><span>Mass</span><b data-v="m">80</b></div><div><span>Debt</span><b data-v="d" class="gold">0</b></div>
          <div><span>Equity</span><b data-v="e">80</b></div><div><span>Health</span><b data-v="h" class="safe">Safe</b></div>
        </div>
        <div class="hc-hf"><span>Health factor</span><div class="hc-track"><i data-fill></i><b class="hc-line"></b></div><span data-hf>no loan</span></div>
      </div>
      <div class="how-count" data-count>// 01 / 06</div>
    </div>
  </div></div>
</section>`;

/** Render the story into box; returns its cleanup (scroll, resize, observer, rAF). */
export function mountStory(box: HTMLElement): () => void {
  box.innerHTML = html;
  const sec = box.querySelector<HTMLElement>(".how")!;
  const q = <T extends HTMLElement>(s: string): T => sec.querySelector<T>(s)!;
  const lis = [...sec.querySelectorAll<HTMLLIElement>(".how-steps li")];
  const card = q("[data-card]");
  const toast = q("[data-toast]");
  const painter = new StoryPainter(q<HTMLCanvasElement>("canvas"));
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let step = -1;
  let t0 = 0;
  let shown = "";
  let toastTimer = 0;

  const showToast = (i: number, te: number): void => {
    const lead = LEAD[i];
    const s = lead && te < lead.at ? lead : TOAST[i]!;
    const key = `${i}${s.t1}`;
    if (key === shown) return;
    shown = key;
    toast.classList.remove("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      q("[data-ico]").textContent = s.ico;
      q("[data-ico]").style.background = s.c;
      q("[data-t1]").textContent = s.t1;
      q("[data-t2]").textContent = s.t2;
      toast.classList.add("show");
    }, 140);
  };

  const setStep = (i: number): void => {
    if (i === step) return;
    step = i;
    t0 = performance.now() / 1000;
    shown = "";
    painter.reset();
    lis.forEach((li, k) => {
      li.classList.toggle("on", k === i);
      li.classList.toggle("done", k < i);
    });
    q("[data-count]").textContent = `// ${pad(i)} / ${pad(N - 1)}`;
    q("[data-clock]").textContent = TOAST[i]!.clk;
    if (still) frame(t0, 0);
  };

  let lastTe = 0;
  const frame = (now: number, dt: number): void => {
    // Reduced motion: each step holds still on the moment its event has landed.
    const te = still ? LOOP[step]! - 0.6 : (now - t0) % LOOP[step]!;
    if (te < lastTe) painter.reset();
    lastTe = te;
    const o = scene(step, te);
    showToast(step, te);
    const hf = healthFactor(o);
    const hp = ringOf(hf);
    q("[data-v=m]").textContent = String(Math.round(o.m));
    q("[data-v=d]").textContent = String(Math.round(o.d));
    q("[data-v=e]").textContent = String(Math.round(o.m - o.d));
    const h = q("[data-v=h]");
    h.textContent = o.popped ? "Popped" : { safe: "Safe", warn: "Warning", liq: "Red" }[hp];
    h.className = o.popped ? "liq" : hp;
    const fill = q("[data-fill]");
    fill.style.width = hf ? `${Math.max(3, Math.min(100, ((hf - 0.8) / 1.2) * 100))}%` : "100%";
    fill.style.background = { safe: "#16C46B", warn: "#E8B500", liq: "#E0243F" }[hp];
    q("[data-hf]").textContent = hf ? hf.toFixed(2) : "no loan";
    card.classList.toggle("popped", o.popped);
    card.classList.toggle("rewind", o.rewind);
    painter.draw(o, step, now, dt);
  };

  const onScroll = (): void => {
    const r = sec.getBoundingClientRect();
    const span = sec.offsetHeight - innerHeight;
    const p = Math.min(0.9999, Math.max(0, -r.top / span));
    const f = p * N;
    const i = Math.floor(f);
    setStep(i);
    lis.forEach((li, k) => {
      li.querySelector<HTMLElement>(".hbar i")!.style.width = k === i ? `${((f - i) * 100).toFixed(1)}%` : "";
    });
  };
  const onResize = (): void => painter.fit();
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  lis.forEach((li, k) =>
    li.querySelector("button")!.addEventListener("click", () => {
      const span = sec.offsetHeight - innerHeight;
      const top = sec.getBoundingClientRect().top + scrollY;
      scrollTo({ top: top + (span * (k + 0.15)) / N, behavior: still ? "auto" : "smooth" });
    }),
  );
  onScroll();

  // The loop only runs while the section is on screen.
  let raf = 0;
  let last = 0;
  const loop = (n: number): void => {
    const dt = Math.min(0.05, (n - last) / 1000);
    last = n;
    frame(n / 1000, dt);
    raf = requestAnimationFrame(loop);
  };
  const io = new IntersectionObserver(([e]) => {
    cancelAnimationFrame(raf);
    if (e?.isIntersecting && !still) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  });
  io.observe(sec);

  return () => {
    io.disconnect();
    cancelAnimationFrame(raf);
    clearTimeout(toastTimer);
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onResize);
  };
}
