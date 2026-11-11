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
  matches: { free: number; paid: number };
  players: { freeGuests: number; wallets: number };
  agentPops: number;
  paidSettled: Array<{ id: string; head: string; tx: string }>;
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
  // Drone wallets: USDC they hold now, read from the USDC contract (agents earn capped bounties).
  let droneUsdc = 0n;
  let drones = 0;
  for (let i = 1; i <= 3 && cfg; i++) {
    const id = `drone-${i}.${contract}`;
    const agent = await viewOnChain<boolean>(net, contract, "is_agent", { account_id: id }).catch(() => null);
    if (!agent?.value) continue;
    drones++;
    const b = await viewOnChain<string>(net, cfg.usdc, "ft_balance_of", { account_id: id }).catch(() => null);
    if (b) droneUsdc += BigInt(b.value);
  }
  const usd = (base: bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;
  const outside = f.wallets.filter((w) => !team.has(w)).length;
  const rpcNote = rpc.size ? `NEAR RPC (${[...rpc].join(", ")})` : "NEAR RPC (unreachable)";
  return {
    net,
    at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: f.source,
    rpc,
    cells: {
      matches: `${none(f.matches.free + f.matches.paid)} (${f.matches.free} free, ${f.matches.paid} paid)`,
      players: `${none(f.players.freeGuests + f.players.wallets)} (${f.players.freeGuests} guests, ${f.players.wallets} verified wallets)`,
      paidOnChain: none(settled),
      usdc: settled ? usd(stakes) : "none yet",
      agentPops: none(f.agentPops),
      droneUsdc: drones ? (droneUsdc > 0n ? `${usd(droneUsdc)} across ${drones} drone wallets` : "none yet") : "no drone wallets registered",
      anchors: none(anchors),
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
  ["Paid matches settled on chain (verified)", "paidOnChain", "rpc"],
  ["USDC moved through paid matches (on-chain stakes)", "usdc", "rpc"],
  ["Liquidations by AI agents", "agentPops", "off"],
  ["USDC held by agent (drone) wallets", "droneUsdc", "rpc"],
  ["Hourly anchors written (verified txs)", "anchors", "rpc"],
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
