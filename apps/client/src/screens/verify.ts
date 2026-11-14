// /verify/:id: anyone re-checks a match in their own browser with the same core code the
// server and contract run (hash chain, money replay, chain anchor). "local" verifies the
// offline match just played; any log file can be dropped in. A Tamper test button edits one
// number live so a judge watches the check turn red at the exact event.
import { MICRO, type LogEntry, type ProofStep } from "@margin/core";
import { serverFor } from "../net/region";
import type { Screen } from "../router";
import { runChecks, type Check, type Report } from "../verify/checks";
import { NETWORK, explorerOf } from "../chain/config";
import { txFunctionCall, viewOnChain } from "../chain/rpc";
import { anchorOnNear, type AnchorClaim } from "./verifyNear";
import { BTN, footerSlot, header, mountSiteFooter } from "./chrome";

/** The offline match log, handed over in memory from the results screen. */
let localLog: LogEntry[] | null = null;
export const setLocalLog = (log: LogEntry[]): void => void (localLog = log);

interface Loaded {
  /** Pointers from our server (mode, anchor tx, Merkle proof). Checked on NEAR, never trusted. */
  claim?: AnchorClaim;
  log: LogEntry[];
  anchorHead?: string | null;
  tx?: string | null;
  network?: "testnet" | "mainnet";
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ICON = { ok: ["✓", "bg-safe text-ink"], bad: ["✗", "bg-liq text-paper"], skip: ["·", "bg-cream text-ink"] } as const;

export const verify: Screen = (root, { id = "" }) => {
  root.innerHTML = `
  <div class="min-h-full bg-paper text-ink">
    ${header()}
    <main class="mx-auto max-w-2xl px-4 pb-24 pt-10">
      <span class="sticker inline-block rounded-field bg-warn px-3 py-1 text-sm font-bold">Do not trust us. Check.</span>
      <h1 class="mt-3 font-display text-6xl">Verify</h1>
      <p class="mt-2 text-muted">Match <span class="num font-bold">${esc(id)}</span>. Every check runs here in your browser, with the same code the server and the NEAR contract use. It proves the log adds up and, once its hour is anchored on NEAR, that it was not changed afterwards. It cannot prove the server played the match fairly before that.</p>
      <div data-v=body class="mt-6 space-y-4"><p class="tag">Loading the match log</p></div>
      <label class="${BTN.card} mt-8 cursor-pointer text-lg">
        Check a log file<input data-v=file type="file" accept="application/json,.json" class="hidden" /></label>
    </main>
    ${footerSlot}
  </div>`;
  const stopFooter = mountSiteFooter(root);
  const body = root.querySelector<HTMLElement>("[data-v=body]")!;

  const show = async (d: Loaded, note = "", real?: Loaded): Promise<void> => {
    // The server's own anchorHead is ignored: the anchor check reads NEAR with the head WE replayed.
    const r = await runChecks(d.log, null, d.claim?.matchId);
    // One hourly anchor slot on the contract belongs to the Mumbai box: US matches are never anchored.
    if (d.claim?.matchId.startsWith("u-")) r.anchor = { state: "skip", detail: "Not anchored on NEAR: US server matches are verified here only (hash chain and books)." };
    else if (d.claim && r.result) r.anchor = await anchorOnNear(r.result.head, d.claim, { view: viewOnChain, tx: txFunctionCall });
    else if (d.claim) r.anchor = { state: "skip", detail: "The log does not replay, so there is no final hash to look up on NEAR." };
    render(body, d, r, note, !!real);
    body.querySelector("[data-v=download]")?.addEventListener("click", () => download(d.log, id));
    body.querySelector("[data-v=tamper]")?.addEventListener("click", () => {
      const t = tamper(d.log);
      if (t) void show({ ...d, log: t.log }, `Tamper test: changed one number in event #${t.seq} and kept the old hash, like an edit made after the log was sealed. Watch which check catches it.`, d);
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
    const get = <T,>(what: string) =>
      fetch(`${serverFor(id).url}/api/matches/${encodeURIComponent(id)}/${what}`).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`HTTP ${r.status}`))));
    type Proof = { mode: "free" | "paid"; anchor?: { hour: number; proof: ProofStep[]; tx: string | null } | null };
    Promise.all([get<Loaded>("log"), get<Proof>("proof")])
      .then(([d, p]) => show({ ...d, claim: { mode: p.mode, matchId: id, anchor: p.anchor ? { hour: p.anchor.hour, proof: p.anchor.proof, tx: p.anchor.tx } : null } }))
      .catch(() => (body.innerHTML = `<p>Could not load this match from the server. You can still check a log file.</p>`));
  }
  return stopFooter;
};

function render(body: HTMLElement, d: Loaded, r: Report, note: string, tampered: boolean): void {
  const card = (title: string, c: Check): string => {
    const [icon, bg] = ICON[c.state];
    return `<article class="sticker flex gap-4 rounded-box bg-card p-4">
      <span class="grid size-10 shrink-0 place-items-center rounded-full border border-grid ${bg} font-display text-xl">${icon}</span>
      <div class="min-w-0"><h2 class="font-display text-2xl">${title}</h2><p class="text-muted">${esc(c.detail)}</p>${badEntry(d.log, c.seq)}</div></article>`;
  };
  const names = new Map<string, string>();
  // Agents and drones wear 🤖 everywhere they are named, here too (P06).
  for (const e of d.log) if (e.type === "JOIN") names.set(e.data.player.id, e.data.player.kind === "human" || e.data.player.label.includes("🤖") ? e.data.player.label : `🤖 ${e.data.player.label}`);
  const payouts = r.result?.payouts
    .map((p) => `<tr><td>${esc(names.get(p.id) ?? p.id)}</td><td class="num text-right">${(p.amount / MICRO).toFixed(2)}</td></tr>`)
    .join("");
  const explorer = d.tx ? `${explorerOf((r.anchor as { network?: typeof NETWORK }).network ?? NETWORK)}/txns/${encodeURIComponent(d.tx)}` : null;
  // One verdict first, so a judge knows the answer before reading the three checks.
  const bad = [r.chain, r.books, r.anchor].some((c) => c.state === "bad");
  const verdict = bad
    ? ["bg-ink text-paper", "\u2717", "This log does not add up.", "Someone changed it after the match. The check below shows where."]
    : r.books.state === "skip"
      ? ["bg-warn text-ink", "?", "Legacy log, rules version unproven.", "It balances under the old rules, but only NEAR holding the same fingerprint can prove it is a real match from before 11 Nov."]
      : r.anchor.state === "ok"
      ? ["bg-safe text-ink", "\u2713", "Log checks out.", "Every hash links, the books balance to the millionth, and NEAR holds the same fingerprint, so the log was not changed after its hour was sealed."]
      : d.claim?.matchId.startsWith("u-")
      ? ["bg-safe text-ink", "\u2713", "Log is consistent.", "Every hash links and the books balance. US server matches are not anchored on NEAR, so nothing here proves the log was not rewritten."]
      : ["bg-safe text-ink", "\u2713", "Consistent so far.", "Every hash links and the books balance. Until the next hourly batch puts its fingerprint on NEAR, nothing proves the log was not rewritten."];
  body.innerHTML = `
    <div class="sticker flex items-center gap-4 rounded-box p-4 ${verdict[0]}">
      <span class="grid size-12 shrink-0 place-items-center rounded-full border border-grid ${bad ? "bg-liq text-paper" : "bg-card text-ink"} font-display text-2xl">${verdict[1]}</span>
      <div><p class="font-display text-3xl leading-none">${verdict[2]}</p><p class="mt-1 text-sm">${verdict[3]}</p></div></div>
    ${note ? `<p class="sticker rounded-field bg-cream px-3 py-2 text-sm font-bold">${esc(note)}</p>` : ""}
    ${card("Hash chain", r.chain)}
    ${card("Books balance", r.books)}
    ${card("Anchored on NEAR", r.anchor)}
    ${payouts ? `<article class="sticker rounded-box bg-cream p-4"><h2 class="font-display text-2xl">Payouts</h2>
      <table class="mt-2 w-full font-mono text-sm">${payouts}</table></article>` : ""}
    <div class="flex flex-wrap gap-3">
      <button data-v=download class="${BTN.card} text-lg">Download log</button>
      ${tampered
        ? `<button data-v=restore class="${BTN.go} text-lg">Restore the real log</button>`
        : `<button data-v=tamper class="${BTN.ink} text-lg">Tamper test</button>`}
      ${explorer ? `<a href="${explorer}" target="_blank" rel="noopener" class="${tampered ? BTN.card : BTN.go} text-lg">${tampered ? "See the real record on NEAR" : "✓ See proof on NEAR"}</a>` : ""}
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
