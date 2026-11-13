// Frame-time budget check: launches its own Chrome, throttles the CPU (4x by default, like
// devtools), opens a page and measures requestAnimationFrame for N seconds. Prints fps and
// frame-time percentiles. Uses only Node built-ins (fetch + WebSocket) and the Chrome DevTools
// protocol, so nothing to install.
//
//   node scripts/perf.mjs [url] [seconds] [cpuRate] [headless 0|1]
//   default: http://localhost:1234/play?local 12 4 1
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url = "http://localhost:1234/play?local", secs = "12", rate = "4", headless = "1"] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "perf-"))}`, "--window-size=1280,800", "--no-first-run", "about:blank"];
if (headless === "1") args.unshift("--headless=new");
const chrome = spawn(CHROME, args, { stdio: "ignore" });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((t) => t.find((x) => x.type === "page")).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener("open", ok));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (pending.has(d.id)) (pending.get(d.id)(d.result ?? d), pending.delete(d.id));
  });
  const send = (method, params = {}) => new Promise((ok) => (pending.set(++id, ok), ws.send(JSON.stringify({ id, method, params }))));

  await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }); // keep rAF running when the window is hidden
  await send("Page.navigate", { url });
  await sleep(14000); // warm-up and GO, so the arena is full
  await send("Emulation.setCPUThrottlingRate", { rate: Number(rate) });
  const r = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise((done) => {
      const t = []; let last = performance.now(); const end = last + ${Number(secs) * 1000};
      const tick = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else done(t); };
      requestAnimationFrame(tick);
    }).then((t) => {
      const s = [...t].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
      const f = window.__frame;
      return { frames: t.length, fps: +(t.length / ${Number(secs)}).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), over33: t.filter((x) => x > 33.4).length, blobs: f?.blobs.length, food: f?.food.length, phase: f?.match.phase };
    })`,
  });
  console.log(JSON.stringify({ url, cpu: `${rate}x`, headless: headless === "1", ...r.result.value }));
  ws.close();
} finally {
  chrome.kill();
}
