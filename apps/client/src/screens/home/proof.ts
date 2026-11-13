// Can't cheat. Can check.: four proof rows that link to the real evidence, and a tamper demo on
// OUR hash chain. The log rows are built with @margin/core appendLog and checked with
// verifyChain, the same code the Verify page and the server run, so the break it finds is real.
import { appendLog, verifyChain, type LogEntry, type PendingLog } from "@margin/core";

const U = 1_000_000;
const REPO = "https://github.com/VanshChitransh/playmargin";
const ext = 'target="_blank" rel="noopener"';

// A short free match log in the real event shapes (amounts in Micro).
const EVENTS: PendingLog[] = [
  { tick: 0, type: "MATCH_START", data: { matchId: "home-example", seed: 7, mode: "free", ratePerMinBps: 600 } },
  { tick: 150, type: "BOOST", data: { blob: "nina", borrowed: 40 * U, fee: 400_000 } },
  { tick: 210, type: "BOOST", data: { blob: "ape", borrowed: 80 * U, fee: 800_000 } },
  { tick: 600, type: "INTEREST", data: { blob: "ape", amount: 2_410_000, toFood: 1_200_000, toVault: 1_010_000, toReserve: 200_000 } },
  { tick: 780, type: "SPIKE", data: { blob: "ape", spike: 3, damage: 30 * U } },
  { tick: 840, type: "POP", data: { by: "nina", victim: "ape", debtRepaid: 80 * U, badDebt: 0, bounty: 8 * U, fee: 2 * U, scattered: 10 * U } },
  { tick: 1500, type: "REPAY", data: { blob: "nina", amount: 40 * U } },
  { tick: 2700, type: "CASHOUT", data: { blob: "nina", amount: 131_590_000 } },
];
const NAME: Record<string, string> = { nina: "Nitro Nina", ape: "Ape Strong" };
const TAMPER_SEQ = 5;

/** One readable line per entry: what happened and the amount it moved. */
function row(e: LogEntry): [string, string] {
  const n = (x: number, sign = ""): string => `${sign}${(x / U).toFixed(2)}`;
  switch (e.type) {
    case "MATCH_START": return ["12 players, match starts", "80.00"];
    case "BOOST": return [`${NAME[e.data.blob]} borrows`, n(e.data.borrowed, "+")];
    case "INTEREST": return [`vault charges ${NAME[e.data.blob]}`, n(e.data.amount, "-")];
    case "SPIKE": return [`${NAME[e.data.blob]} hits a spike`, n(e.data.damage, "-")];
    case "POP": return [`${NAME[e.data.by ?? ""] ?? "a drone"} pops ${NAME[e.data.victim]}`, n(e.data.bounty, "+")];
    case "REPAY": return [`${NAME[e.data.blob]} repays the vault`, n(e.data.amount, "-")];
    case "CASHOUT": return [`${NAME[e.data.blob]} cashes out`, n(e.data.amount)];
    default: return [e.type, ""];
  }
}

const PROOFS: [string, string, string, string][] = [
  ["Every match is a sealed log", "Each event is hashed into the one before. Edit one number and the chain breaks.", "/judges", "Verify a match"],
  ["Bots wear 🤖. Drones are accounts.", "Liquidator drones are NEAR accounts. Every bounty they earn is public on chain.", "https://testnet.nearblocks.io/address/drone-1.playmargin.testnet", "drone-1 ↗"],
  ["Your key can play. It can't withdraw.", "The session key covers play only. We stole one and tried. NEAR said no.", `${REPO}/blob/main/docs/NEAR.md#stolen-session-key-cannot-withdraw`, "Stolen-key test ↗"],
  ["Settled to the millionth", "On NEAR testnet, payouts plus repaid plus fees equal stakes plus lent. Exactly.", "https://testnet.nearblocks.io/txns/3Nw3RqiAfPmFYJ5LKxxXioEfppLhdEswXyTHhyZQABwA", "Settle tx ↗"],
];

const html = `<section class="trust" id="proof" aria-label="Proof"><div class="wrap">
  <div class="head"><div><div class="kicker">Proof</div><h2>Can't cheat.<br>Can check.</h2></div>
    <p>Every match writes a hash-chained log. Break it on purpose and watch the check fail.</p></div>
  <div class="tgrid">
    <div class="proofs">${PROOFS.map(([b, p, href, label], i) => `<div class="proof"><span class="n">${String(i + 1).padStart(2, "0")}</span><div><b>${b}</b><p>${p}</p></div><a href="${href}" ${href.startsWith("http") ? ext : ""}>${label}</a></div>`).join("")}</div>
    <div>
      <div class="log">
        <div class="lh"><b>Example match log</b><span>SHA-256 chain, checked in your browser</span></div>
        <div class="rows" data-rows></div>
        <div class="lf"><div class="lstat" data-status role="status"><i></i>Checking the chain</div><button class="tamper" data-tamper>Tamper with it</button></div>
      </div>
      <p class="note">Try it: the button changes one number. The same check our Verify page runs finds the break.</p>
    </div>
  </div>
</div></section>`;

/** Render the proof section into box; returns its cleanup. */
export function mountProof(box: HTMLElement): () => void {
  box.innerHTML = html;
  const rows = box.querySelector<HTMLElement>("[data-rows]")!;
  const status = box.querySelector<HTMLElement>("[data-status]")!;
  const btn = box.querySelector<HTMLButtonElement>("[data-tamper]")!;
  const honest: LogEntry[] = [];
  let tampered = false;
  let gone = false;

  const render = async (): Promise<void> => {
    // Tampering edits one amount but keeps its stored hash, exactly what a forger would ship.
    const log = honest.map((e) => (tampered && e.seq === TAMPER_SEQ && e.type === "POP" ? { ...e, data: { ...e.data, bounty: 80 * U } } : e));
    const bad = await verifyChain(log);
    if (gone) return;
    rows.innerHTML = log
      .map((e) => {
        const [what, amt] = row(e);
        const cls = bad === null ? "" : e.seq === bad ? "bad" : e.seq > bad ? "after" : "";
        return `<div class="row ${cls}"><span class="i">#${String(e.seq).padStart(4, "0")}</span><span>${what}</span><span class="amt">${amt}</span><span class="h">${e.hash.slice(0, 6)}…${e.hash.slice(-4)}</span><span class="ok" aria-label="${bad !== null && e.seq >= bad ? "fails" : "checks out"}">${bad !== null && e.seq >= bad ? "✕" : "✓"}</span></div>`;
      })
      .join("");
    status.className = `lstat${bad === null ? "" : " bad"}`;
    status.innerHTML = bad === null ? "<i></i>Honest. Every link checks out." : `<i></i>Broken at #${String(bad).padStart(4, "0")}. This log does not add up.`;
    btn.className = `tamper${tampered ? " on" : ""}`;
    btn.textContent = tampered ? "Undo tamper" : "Tamper with it";
  };

  void appendLog(honest, EVENTS).then(() => render());
  const onClick = (): void => {
    tampered = !tampered;
    void render();
  };
  btn.addEventListener("click", onClick);
  return () => {
    gone = true;
    btn.removeEventListener("click", onClick);
  };
}
