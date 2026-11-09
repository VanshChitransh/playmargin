// #/verify/:id: anyone re-checks a match in their own browser with the same core code the
// server and contract run (hash chain, money replay, chain anchor). "local" verifies the
// offline match just played; any log file can be dropped in. A Tamper test button edits one
// number live so a judge watches the check turn red at the exact event.
import { MICRO, type LogEntry } from "@margin/core";
import { ENDPOINT } from "../net/client";
import type { Screen } from "../router";
import { runChecks, type Check, type Report } from "../verify/checks";

/** The offline match log, handed over in memory from the results screen. */
let localLog: LogEntry[] | null = null;
export const setLocalLog = (log: LogEntry[]): void => void (localLog = log);

interface Loaded {
  log: LogEntry[];
  anchorHead?: string | null;
  tx?: string | null;
  network?: "testnet" | "mainnet";
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ICON = { ok: ["✓", "bg-safe"], bad: ["✗", "bg-liq"], skip: ["·", "bg-muted"] } as const;

export const verify: Screen = (root, { id = "" }) => {
  root.innerHTML = `
  <div class="min-h-full bg-liq px-4 py-8 text-ink">
    <div class="mx-auto max-w-2xl">
      <a href="#/" class="tag">← MARGIN</a>
      <h1 class="outlined mt-3 font-display text-6xl text-paper">Verify</h1>
      <p class="mt-2">Match <span class="num font-bold">${esc(id)}</span>. Every check runs here in your browser, with the same code the server and the NEAR contract use.</p>
      <div data-v=body class="mt-6 space-y-4"><p class="tag">Loading the match log</p></div>
      <label class="sticker sticker-press mt-8 inline-block cursor-pointer rounded-box bg-paper px-4 py-2 font-display text-lg">
        Check a log file<input data-v=file type="file" accept="application/json,.json" class="hidden" /></label>
    </div>
  </div>`;
  const body = root.querySelector<HTMLElement>("[data-v=body]")!;

  const show = async (d: Loaded, note = "", real?: Loaded): Promise<void> => {
    render(body, d, await runChecks(d.log, d.anchorHead), note, !!real);
    body.querySelector("[data-v=download]")?.addEventListener("click", () => download(d.log, id));
    body.querySelector("[data-v=tamper]")?.addEventListener("click", () => {
      const t = tamper(d.log);
      if (t) void show({ ...d, log: t.log }, `Tamper test: changed one number in event #${t.seq}. Watch which check catches it.`, d);
    });
    body.querySelector("[data-v=restore]")?.addEventListener("click", () => real && void show(real));
  };

  root.querySelector<HTMLInputElement>("[data-v=file]")!.addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()) as LogEntry[] | Loaded;
      await show(Array.isArray(j) ? { log: j } : j, `From file ${f.name}.`);
    } catch {
      body.innerHTML = `<p class="font-bold">That file is not a MARGIN match log.</p>`;
    }
  });

  if (id === "local") {
    if (localLog) void show({ log: localLog }, "Offline practice match: not anchored on NEAR.");
    else body.innerHTML = `<p>No offline match in this tab yet. Play one, then press Verify on the receipt.</p>`;
  } else {
    fetch(`${ENDPOINT}/api/matches/${encodeURIComponent(id)}/log`)
      .then((r) => (r.ok ? (r.json() as Promise<Loaded>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => show(d))
      .catch(() => (body.innerHTML = `<p>Could not load this match from the server. You can still check a log file.</p>`));
  }
};

function render(body: HTMLElement, d: Loaded, r: Report, note: string, tampered: boolean): void {
  const card = (title: string, c: Check): string => {
    const [icon, bg] = ICON[c.state];
    return `<article class="sticker flex gap-4 rounded-box bg-paper p-4">
      <span class="grid size-10 shrink-0 place-items-center rounded-full border-4 border-ink ${bg} font-display text-xl text-ink">${icon}</span>
      <div><h2 class="font-display text-2xl">${title}</h2><p>${esc(c.detail)}</p>${badEntry(d.log, c.seq)}</div></article>`;
  };
  const names = new Map<string, string>();
  for (const e of d.log) if (e.type === "JOIN") names.set(e.data.player.id, e.data.player.label);
  const payouts = r.result?.payouts
    .map((p) => `<tr><td>${esc(names.get(p.id) ?? p.id)}</td><td class="num text-right">${(p.amount / MICRO).toFixed(2)}</td></tr>`)
    .join("");
  const explorer = d.tx ? `https://${d.network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${encodeURIComponent(d.tx)}` : null;
  // One verdict first, so a judge knows the answer before reading the three checks.
  const bad = [r.chain, r.books, r.anchor].some((c) => c.state === "bad");
  const verdict = bad
    ? ["bg-ink text-paper", "\u2717", "This log does not add up.", "Someone changed it after the match. The check below shows where."]
    : r.anchor.state === "ok"
      ? ["bg-paper text-ink", "\u2713", "Honest match.", "Every hash links, the books balance to the millionth, and NEAR holds the same fingerprint."]
      : ["bg-paper text-ink", "\u2713", "Honest so far.", "Every hash links and the books balance. The NEAR anchor comes with the next hourly batch."];
  body.innerHTML = `
    <div class="sticker flex items-center gap-4 rounded-box p-4 ${verdict[0]}">
      <span class="grid size-12 shrink-0 place-items-center rounded-full border-4 border-ink ${bad ? "bg-liq" : "bg-safe"} font-display text-2xl text-ink">${verdict[1]}</span>
      <div><p class="font-display text-3xl leading-none">${verdict[2]}</p><p class="mt-1 text-sm">${verdict[3]}</p></div></div>
    ${note ? `<p class="tag">${esc(note)}</p>` : ""}
    ${card("Hash chain", r.chain)}
    ${card("Books balance", r.books)}
    ${card("Anchored on NEAR", r.anchor)}
    ${payouts ? `<article class="sticker rounded-box bg-paper p-4"><h2 class="font-display text-2xl">Payouts</h2>
      <table class="mt-2 w-full font-mono text-sm">${payouts}</table></article>` : ""}
    <div class="flex flex-wrap gap-3">
      <button data-v=download class="sticker sticker-press rounded-box bg-paper px-4 py-2 font-display text-lg">Download log</button>
      ${tampered
        ? `<button data-v=restore class="sticker sticker-press rounded-box bg-ink px-4 py-2 font-display text-lg text-paper">Restore the real log</button>`
        : `<button data-v=tamper class="sticker sticker-press rounded-box bg-ink px-4 py-2 font-display text-lg text-paper">Tamper test</button>`}
      ${explorer ? `<a href="${explorer}" target="_blank" rel="noopener" class="sticker sticker-press rounded-box bg-paper px-4 py-2 font-display text-lg">✓ Verified → See proof</a>` : ""}
    </div>`;
}

function badEntry(log: LogEntry[], seq?: number): string {
  if (seq === undefined) return "";
  const e = log[seq];
  return e ? `<pre class="mt-2 overflow-x-auto rounded-field bg-ink p-2 text-xs text-paper">${esc(JSON.stringify({ seq: e.seq, type: e.type, data: e.data }, null, 1))}</pre>` : "";
}

/** Bump one money number in the middle of the log, keeping the old hash (what a cheat would do). */
function tamper(log: LogEntry[]): { log: LogEntry[]; seq: number } | null {
  const t = structuredClone(log);
  const money = t.filter((e) => e.type === "BOOST" || e.type === "CHARGE" || e.type === "CASHOUT");
  const e = money[Math.floor(money.length / 2)];
  if (!e) return null;
  const data = e.data as Record<string, unknown>;
  const key = Object.keys(data).find((k) => typeof data[k] === "number" && k !== "tick");
  if (!key) return null;
  data[key] = (data[key] as number) + MICRO;
  return { log: t, seq: e.seq };
}

function download(log: LogEntry[], id: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(log, null, 1)], { type: "application/json" }));
  a.download = `margin-${id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
