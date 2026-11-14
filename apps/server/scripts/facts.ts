// `npm run facts`: the README's "What is real, today" table, from real sources only. Off-chain counts
// come from a server (/api/facts) or a DB file; every on-chain row is VERIFIED on NEAR over RPC (a paid
// match counts only if match_of holds the same head and is Settled, an anchor only if its tx is a
// successful anchor), never taken from our own records. Zero prints "none yet", never a padded number.
// Usage: npm run facts -- --net testnet:http://localhost:2567 [--net mainnet:https://api.playmargin.fun]
//        [--net testnet:/path/margin.sqlite] [--team a.testnet,b.near]   (team = our own wallets)
import { txFunctionCall, viewOnChain } from "../../client/src/chain/rpc";

type Net = "testnet" | "mainnet";
interface Facts {
  generatedAt: string;
  contract: string | null;
  matchesWithRealPlayers: { free: number; paid: number };
  players: { freeGuests: number; wallets: number };
  agentPops: number;
  paidSettled: Array<{ id: string; head: string; tx: string; team: boolean }>;
  anchors: Array<{ hour: number; tx: string }>;
  wallets: string[];
}

const args = process.argv.slice(2);
const all = (k: string) => args.flatMap((a, i) => (a === `--${k}` && args[i + 1] ? [args[i + 1]!] : []));
const team = new Set(all("team").flatMap((t) => t.split(",")).map((t) => t.trim()).filter(Boolean));
const sources = all("net").map((v) => {
  const [net, ...rest] = v.split(":");
  if (net !== "testnet" && net !== "mainnet") throw new Error(`--net must be testnet:<source> or mainnet:<source>, got ${v}`);
  return { net: net as Net, src: rest.join(":") };
});
if (!sources.length) {
  console.error("usage: npm run facts -- --net testnet:<server url or db path> [--net mainnet:<...>] [--team our,wallets]");
  process.exit(2);
}
const DEFAULT_CONTRACT: Record<Net, string> = { testnet: "playmargin.testnet", mainnet: "playmargin.near" };
const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

async function load(src: string, net: Net): Promise<Facts & { source: string }> {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(`${src.replace(/\/$/, "")}/api/facts`);
    if (!r.ok) throw new Error(`${src}/api/facts answered ${r.status}`);
    return { ...((await r.json()) as Facts), source: `server ${host(src)} /api/facts` };
  }
  const { openDb } = await import("../src/db");
  const { facts } = await import("../src/api");
  return { ...(facts(openDb(src), net) as Facts), source: `DB ${src.split("/").pop()}` };
}

interface Column { net: Net; at: string; source: string; rpc: Set<string>; cells: Record<string, string> }
const none = (n: number, fmt = (x: number) => x.toLocaleString("en-US")) => (n > 0 ? fmt(n) : "none yet");

async function column(net: Net, src: string): Promise<Column> {
  const f = await load(src, net);
  const contract = f.contract ?? DEFAULT_CONTRACT[net];
  const rpc = new Set<string>();
  const cfg = await viewOnChain<{ settler: string; usdc: string }>(net, contract, "config", {}).then((x) => (rpc.add(host(x.rpc)), x.value)).catch(() => null);

  // Paid matches: only those NEAR itself holds as Settled with the same head; USDC moved = their on-chain stakes.
  let settled = 0;
  let stakes = 0n;
  for (const m of f.paidSettled) {
    const on = await viewOnChain<{ status: string; head: string; stakes: string } | null>(net, contract, "match_of", { match_id: m.id }).catch(() => null);
    if (on) rpc.add(host(on.rpc));
    if (on?.value?.status === "Settled" && on.value.head === m.head) (settled++, (stakes += BigInt(on.value.stakes)));
  }
  // Anchors: only txs NEAR reports as a successful "anchor" call by our settler.
  let anchors = 0;
  for (const a of f.anchors) {
    const t = cfg ? await txFunctionCall(net, a.tx, cfg.settler).catch(() => null) : null;
    if (t) rpc.add(host(t.rpc));
    if (t?.status === "ok" && t.method === "anchor") anchors++;
  }
  // Agent (drone) wallets, straight from NEAR whatever DB was given (QA-E-14): bounties are paid into the
  // contract's own balance (balance_of, what /judges reads); anything withdrawn sits in the USDC token.
  let droneInGame = 0n;
  let droneWallet = 0n;
  let drones = 0;
  for (let i = 1; i <= 3; i++) {
    const id = `drone-${i}.${contract}`;
    const agent = await viewOnChain<boolean>(net, contract, "is_agent", { account_id: id }).catch(() => null);
    if (!agent?.value) continue;
    drones++;
    const inGame = await viewOnChain<string>(net, contract, "balance_of", { account_id: id }).catch(() => null);
    if (inGame) droneInGame += BigInt(inGame.value);
    const wallet = cfg ? await viewOnChain<string>(net, cfg.usdc, "ft_balance_of", { account_id: id }).catch(() => null) : null;
    if (wallet) droneWallet += BigInt(wallet.value);
  }
  // Latest hourly anchor, straight from the contract (anchor_of keeps only the latest hour).
  const latest = await viewOnChain<{ seq: number; head: string; at: string | number } | null>(net, contract, "anchor_of", { room_id: "free" }).catch(() => null);
  if (latest) rpc.add(host(latest.rpc));
  const usd = (base: bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;
  /** USDC to the base unit, exactly as the chain holds it (6 decimals, no rounding). */
  const exact = (base: bigint) => `${base / 1_000_000n}.${String(base % 1_000_000n).padStart(6, "0")}`;
  const outside = f.wallets.filter((w) => !team.has(w)).length;
  const real = f.matchesWithRealPlayers;
  const ours = f.paidSettled.filter((m) => m.team).length;
  const rpcNote = rpc.size ? `NEAR RPC (${[...rpc].join(", ")})` : "NEAR RPC (unreachable)";
  return {
    net,
    at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: f.source,
    rpc,
    cells: {
      matches: `${none(real.free + real.paid)} (${real.free} free, ${real.paid} paid)`,
      players: `${none(f.players.freeGuests + f.players.wallets)} (${f.players.freeGuests} guests, ${f.players.wallets} verified wallets)`,
      paidOnChain: f.paidSettled.length ? `${settled} of ${f.paidSettled.length} in our records verified${ours ? ` (${ours} played by our own test accounts)` : ""}` : "none in our records",
      usdc: settled ? usd(stakes) : "none yet",
      agentPops: none(f.agentPops),
      droneUsdc: drones
        ? droneInGame + droneWallet > 0n
          ? `${exact(droneInGame + droneWallet)} USDC (${usd(droneInGame + droneWallet)}) across ${drones} registered drones: ${exact(droneInGame)} in-game balance, ${exact(droneWallet)} withdrawn to wallets`
          : `none yet (${drones} registered drones)`
        : "no drone accounts registered",
      latestAnchor: latest?.value
        ? `hour ${latest.value.seq}, ${((Date.now() - Number(latest.value.at) / 1e6) / 3_600_000).toFixed(1)} h ago (head ${latest.value.head.slice(0, 10)}...)`
        : "none yet",
      anchors: f.anchors.length ? `${anchors} of ${f.anchors.length} in our records verified` : "none in our records",
      mainnetTx: net === "mainnet" ? none(settled + anchors) : "n/a (testnet)",
      outside: team.size ? none(outside) : `${none(outside)} (no --team given: our own wallets are not excluded)`,
      _offchain: f.source,
      _rpc: rpcNote,
    },
  };
}

const cols: Column[] = [];
for (const s of sources) cols.push(await column(s.net, s.src));
const ROWS: Array<[string, keyof Column["cells"], "off" | "rpc"]> = [
  ["Matches played with a real human", "matches", "off"],
  ["Unique human players", "players", "off"],
  ["Paid matches settled on chain (our records, each verified on NEAR: no contract view lists matches)", "paidOnChain", "rpc"],
  ["USDC moved through paid matches (on-chain stakes)", "usdc", "rpc"],
  ["Liquidations by AI agents", "agentPops", "off"],
  ["USDC earned by AI agent (drone) accounts", "droneUsdc", "rpc"],
  ["Latest hourly anchor on NEAR (anchor_of)", "latestAnchor", "rpc"],
  ["Hourly anchor txs (our records, each verified on NEAR: the contract keeps only the latest)", "anchors", "rpc"],
  ["Mainnet transactions (settles + anchors, verified)", "mainnetTx", "rpc"],
  ["Outside players (wallets that are not ours)", "outside", "off"],
];
const out: string[] = [];
out.push(`### What is real, today`, "");
out.push(`Generated by \`npm run facts\` at ${cols.map((c) => `${c.at} (${c.net})`).join(", ")}. Every on-chain row is checked on NEAR, not taken from our records. Zero says "none yet".`, "");
out.push(`| | ${cols.map((c) => c.net).join(" | ")} | Source |`);
out.push(`|---|${cols.map(() => "---").join("|")}|---|`);
for (const [label, key, kind] of ROWS) {
  const src = kind === "off" ? cols.map((c) => c.cells._offchain).filter((v, i, a) => a.indexOf(v) === i).join("; ") : cols.map((c) => c.cells._rpc).filter((v, i, a) => a.indexOf(v) === i).join("; ");
  out.push(`| ${label} | ${cols.map((c) => c.cells[key]).join(" | ")} | ${src} |`);
}
console.log(out.join("\n"));
