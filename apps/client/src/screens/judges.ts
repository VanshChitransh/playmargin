// /judges: every claim MARGIN makes, checked live in the viewer's browser against NEAR (and the
// game engine), with OK / FAIL / NONE YET and the link to check it yourself. Read only, so phones
// may open it. Verdict rules live in judges/claims.ts (tested); this file fetches and draws.
import { settle, verifyChain } from "@margin/core";
import { CONTRACT_ID, EXPLORER, NETWORK, USDC_ID } from "../chain/config";
import { ARCHIVAL, rpcUrls } from "../chain/rpc";
import { LocalMatch } from "../game/local";
import { ENDPOINT } from "../net/client";
import type { Screen } from "../router";
import { BTN, header } from "./chrome";
import { anchorVerdict, configVerdict, count, firstCall, droneVerdict, relayVerdict, sessionKeyVerdict, settleVerdict, type RawTx, type State, type Verdict } from "../judges/claims";

// Old txs fall out of regular RPC nodes after about 2.5 days, so archival nodes go first (same list as /verify).
const RPCS = rpcUrls(NETWORK, ARCHIVAL[NETWORK]);

// Real transactions to check, per network (signers looked up once, every fact re-read live).
// Mainnet stays empty until those transactions exist: the cards then say "none yet".
const FACTS: Partial<Record<string, { settleTx: string; bountyTx: string; drone: string; keyTx: string; player: string; sessionKey: string; relayTx: string }>> = {
  testnet: {
    settleTx: "3Nw3RqiAfPmFYJ5LKxxXioEfppLhdEswXyTHhyZQABwA",
    bountyTx: "8nDTHu1ZmeW19fSEaa9LoXtrUtdSsEALwVJWdNfpuWwf",
    drone: "drone-1.playmargin.testnet",
    keyTx: "F3GzT78QTH1RkLCwpM89JjFsgdfZAGt9hNqbC365Cug8",
    player: "e2e.playmargin.testnet",
    sessionKey: "ed25519:BFdv4QHUP7sAhtZwB86wkPYLc97m1v9jSfzNviVWtXv3",
    relayTx: "6ZSeFrGuuHC6Y6G6swxtpLodk9gjZUJk6cqhmdR2Tn4P",
  },
};
const CODE = "https://github.com/VanshChitransh/playmargin/blob/main/";

async function rpc<T>(method: string, params: object): Promise<T> {
  let last: unknown = new Error("no RPC answered");
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as { result?: T; error?: unknown };
      if (j.result !== undefined && !(j.result as { error?: unknown }).error) return j.result;
      last = new Error(JSON.stringify(j.error ?? j.result).slice(0, 120));
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
const view = async <T,>(method: string, args: object = {}): Promise<T> => {
  const r = await rpc<{ result: number[] }>("query", { request_type: "call_function", finality: "final", account_id: CONTRACT_ID, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result))) as T;
};
const tx = (hash: string, signer: string) => rpc<RawTx>("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" });

interface Claim {
  title: string;
  how: string;
  code: string;
  links: () => [string, string][];
  check: () => Promise<Verdict>;
}

const facts = FACTS[NETWORK];
const none = (what: string): Verdict => ({ state: "none", detail: `None yet on ${NETWORK}: ${what}` });
const txLink = (h: string): string => `${EXPLORER}/txns/${h}`;
const acct = (a: string): string => `${EXPLORER}/address/${a}`;

const claims: Claim[] = [
  {
    title: "The money sits in a contract, not with us",
    how: "Reads config() from the contract: who settles, which USDC it takes, the paid entry.",
    code: "contracts/margin/src/lib.rs",
    links: () => [["Contract", acct(CONTRACT_ID)]],
    check: async () => configVerdict(await view("config"), USDC_ID),
  },
  {
    title: "Every paid match settles once, with books that balance exactly",
    how: "Reads a real settle transaction, then asks the contract for that match: it must be Settled with the same log head.",
    code: "contracts/margin/src/arena.rs",
    links: () => (facts ? [["Settle tx", txLink(facts.settleTx)]] : []),
    check: async () => {
      if (!facts) return none("no paid match has settled here yet.");
      const config = await view<{ settler: string }>("config");
      const t = await tx(facts.settleTx, config.settler);
      const id = firstCall(t)?.args.match_id;
      return settleVerdict(t, typeof id === "string" ? await view("match_of", { match_id: id }) : null);
    },
  },
  {
    title: "The AI liquidators are labelled accounts with public pay",
    how: "Asks the contract if the drone is a registered agent, reads its balance and the settle that paid it a bounty.",
    code: "contracts/margin/src/lib.rs",
    links: () => (facts ? [["Drone account", acct(facts.drone)], ["Bounty tx", txLink(facts.bountyTx)]] : []),
    check: async () => {
      if (!facts) return none("no drone has earned a bounty here yet.");
      const config = await view<{ settler: string }>("config");
      const [isAgent, balance, t] = await Promise.all([view<boolean>("is_agent", { account_id: facts.drone }), view<string>("balance_of", { account_id: facts.drone }), tx(facts.bountyTx, config.settler)]);
      return droneVerdict(facts.drone, isAgent, balance, t);
    },
  },
  {
    title: "A stolen session key cannot take money out",
    how: "Reads the player's quick-play key from NEAR: which contract and which methods it may call.",
    code: "apps/client/src/chain/session.ts",
    links: () => (facts ? [["AddKey tx", txLink(facts.keyTx)]] : []),
    check: async () => {
      if (!facts) return none("no quick-play key has been added here yet.");
      try {
        const k = await rpc<{ permission: unknown }>("query", { request_type: "view_access_key", finality: "final", account_id: facts.player, public_key: facts.sessionKey });
        return sessionKeyVerdict(k.permission, CONTRACT_ID);
      } catch {
        // The key was removed since: judge it by the transaction that added it.
        const t = await tx(facts.keyTx, facts.player);
        const add = t.transaction.actions.map((a) => (typeof a === "object" ? (a.AddKey as { access_key: { permission: unknown } } | undefined) : undefined)).find(Boolean);
        return add ? sessionKeyVerdict(add.access_key.permission, CONTRACT_ID) : { state: "fail", detail: "That transaction did not add a key." };
      }
    },
  },
  {
    title: "Our relayer pays the gas, and only for entering a match",
    how: "Reads a relayed ticket: a NEP-366 delegate whose only action must be a zero-deposit enter_arena.",
    code: "services/relayer/validate.ts",
    links: () => (facts ? [["Relayed tx", txLink(facts.relayTx)]] : []),
    check: async () => (facts ? relayVerdict(await tx(facts.relayTx, `relayer.${CONTRACT_ID}`), CONTRACT_ID) : none("no relayed ticket here yet.")),
  },
  {
    title: "Free matches are anchored on NEAR every hour",
    how: "Reads the newest hourly Merkle root of free matches from the contract.",
    code: "apps/server/src/anchor/job.ts",
    links: () => [["Contract", acct(CONTRACT_ID)]],
    check: async () => anchorVerdict(await view("anchor_of", { room_id: "free" }), Date.now()),
  },
  {
    title: "The game cannot create money",
    how: "Plays a full 90 s match on the real rules right here in your browser, then replays its log through the same settle() the server and contract use.",
    code: "packages/core/src/settle.ts",
    links: () => [["Play and verify one yourself", "/play"]],
    check: async () => {
      const m = new LocalMatch({ seed: (Math.random() * 1e9) | 0, withMe: false, bots: 11, warmupS: 0, greedy: true });
      for (let t = 0; m.w.phase !== "ENDED" && t < 120_000; t += 1000 / 60) m.frameAt(t);
      const log = await m.log();
      if ((await verifyChain(log)) !== null) return { state: "fail", detail: "The match log's hash chain is broken." };
      const r = settle(log);
      const pops = log.filter((e) => e.type === "POP" || e.type === "KEEPER_POP").length;
      return { state: "ok", detail: `${count(log.length, "event")}, ${count(pops, "liquidation")}, hash chain intact, settle() balanced to the last millionth of a credit (head ${r.head.slice(0, 10)}...).` };
    },
  },
  {
    title: "Real players, counted honestly",
    how: "Asks the game server for its live counts (humans only: bot rooms, tests and Judge Runs are left out).",
    code: "apps/server/src/api.ts",
    links: () => [],
    check: async () => {
      const mainnet = NETWORK === "mainnet" ? "" : " Mainnet: none yet. Outside players paying in on mainnet: none yet.";
      try {
        const s = (await (await fetch(`${ENDPOINT}/api/stats`, { signal: AbortSignal.timeout(8000) })).json()) as { players: number; matches: number; agentPops: number; multiHumanPct: number };
        const st: State = s.players > 0 ? "ok" : "none";
        return { state: st, detail: `${count(s.players, "player")}, ${count(s.matches, "match", "matches")} with a human, ${s.multiHumanPct}% with two or more humans, ${count(s.agentPops, "liquidation")} by AI agents.${mainnet}` };
      } catch {
        return { state: "unreachable", detail: `The game server did not answer, so there is no live count to show.${mainnet}` };
      }
    },
  },
];

const BADGE: Record<State | "run", string> = {
  ok: `<span class="pop-sm rounded-lg bg-safe px-2 py-1 font-display text-lg">OK</span>`,
  fail: `<span class="pop-sm rounded-lg bg-liq px-2 py-1 font-display text-lg text-card">FAIL</span>`,
  none: `<span class="pop-sm rounded-lg bg-warn px-2 py-1 font-display text-lg">NONE YET</span>`,
  unreachable: `<span class="pop-sm rounded-lg bg-cream px-2 py-1 font-display text-lg text-muted">CAN'T CHECK</span>`,
  run: `<span class="pop-sm rounded-lg bg-card px-2 py-1 font-display text-lg text-muted">CHECKING</span>`,
};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const judges: Screen = (root) => {
  root.innerHTML = `<div class="paper-dots min-h-dvh text-ink">${header()}
    <main class="mx-auto max-w-4xl px-4 pb-16">
      <h1 class="font-display text-4xl sm:text-5xl">For judges: every claim, checked live</h1>
      <p class="mt-2 max-w-2xl font-medium text-muted">Each card below runs in your browser now, reading NEAR ${NETWORK} directly (contract <b class="text-ink">${CONTRACT_ID}</b>), not our server. OK means the check passed, NONE YET means it has not happened yet, and we say so.</p>
      <button data-j=again class="${BTN.small} mt-4">Run all checks again</button>
      <ol data-j=list class="mt-6 grid gap-4"></ol>
    </main></div>`;
  const list = root.querySelector<HTMLElement>("[data-j=list]")!;
  let gone = false;
  const run = (): void => {
    list.innerHTML = claims
      .map((c, i) => `<li class="pop rounded-2xl bg-card p-4 sm:p-5">
        <div class="flex items-start justify-between gap-3"><h2 class="font-display text-xl sm:text-2xl">${i + 1}. ${c.title}</h2><span data-j=badge-${i} class="shrink-0">${BADGE.run}</span></div>
        <p class="mt-1 text-sm text-muted">${c.how}</p>
        <p data-j=detail-${i} class="mt-3 font-semibold">Checking...</p>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">${c.links().map(([t, h]) => `<a class="${BTN.small}" href="${h}"${h.startsWith("#") ? "" : ` target="_blank" rel="noopener"`}>${t}</a>`).join("")}
          <a class="font-mono text-xs text-muted underline" href="${CODE}${c.code}" target="_blank" rel="noopener">${c.code}</a></div></li>`)
      .join("");
    claims.forEach((c, i) => {
      // One at a time would take a minute on a slow RPC: run them together, each card fills in when ready.
      void c.check().catch((e: Error) => ({ state: "unreachable" as const, detail: `Could not reach NEAR to check (${esc(String(e.message)).slice(0, 90)}). Try again in a minute.` })).then((v) => {
        if (gone) return;
        root.querySelector(`[data-j=badge-${i}]`)!.innerHTML = BADGE[v.state];
        root.querySelector(`[data-j=detail-${i}]`)!.textContent = v.detail;
      });
    });
  };
  root.querySelector("[data-j=again]")!.addEventListener("click", run);
  run();
  return () => void (gone = true);
};
