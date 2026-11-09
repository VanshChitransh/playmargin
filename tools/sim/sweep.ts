// `npm run sweep -- [matches] [configs JSON]`: liquidation balance per constant set, without touching
// the real constants. Each config gets a temp copy of packages/core/src with its numbers patched,
// and balance.ts runs against it via a tsconfig `paths` override of @margin/core.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Cfg = {
  name: string;
  rules?: Record<string, number>;
  /** Other core numbers not in RULES: file under src -> [regex, replacement]. */
  src?: Record<string, [string, string][]>;
  caution?: number;
};
// BOOST is hold-to-nitro (9 Nov): candidates for its borrow rate, on top of balance B. Each runs
// twice: the greedy player dodging spikes like a practised bot (caution 0.6) and like a first-timer (0.2).
const CONFIGS: Cfg[] = [0.6, 0.2].flatMap((caution) =>
  [0.75, 1.0, 1.5].map((rate) => ({ name: `nitro ${rate}x equity/s (caution ${caution})`, caution, rules: { NITRO_RATE_EQUITY_PER_S: rate } })),
);
const extra = process.argv[3] ? (JSON.parse(process.argv[3]) as Cfg[]) : [];

const n = process.argv[2] ?? "200";
const root = resolve(import.meta.dirname, "../..");
const rows: string[] = [];
for (const c of extra.length ? extra : CONFIGS) {
  const dir = mkdtempSync(join(tmpdir(), "margin-sweep-"));
  try {
    cpSync(join(root, "packages/core/src"), join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), `{"type":"module"}`);
    const cp = join(dir, "src/constants.ts");
    let s = readFileSync(cp, "utf8");
    for (const [k, v] of Object.entries(c.rules ?? {})) {
      const re = new RegExp(`("${k}": )[0-9.]+`);
      if (!re.test(s)) throw new Error(`no rule ${k}`);
      s = s.replace(re, `$1${v}`);
    }
    writeFileSync(cp, s);
    for (const [f, subs] of Object.entries(c.src ?? {})) {
      const fp = join(dir, "src", f);
      let t = readFileSync(fp, "utf8");
      for (const [from, to] of subs) {
        if (!new RegExp(from).test(t)) throw new Error(`no ${from} in ${f}`);
        t = t.replace(new RegExp(from), to);
      }
      writeFileSync(fp, t);
    }
    const ts = join(dir, "tsconfig.json");
    writeFileSync(ts, JSON.stringify({ extends: join(root, "tsconfig.base.json"), compilerOptions: { baseUrl: root, paths: { "@margin/core": [join(dir, "src/index.ts")] } } }));
    const out = execFileSync("npx", ["tsx", "--tsconfig", ts, join(root, "tools/sim/balance.ts"), n, String(c.caution ?? 0.6)], { cwd: root, encoding: "utf8" });
    const r = JSON.parse(out.trim().split("\n").at(-1) as string);
    const pct = (x: number): string => `${Math.round(x * 100)}%`;
    rows.push(`| ${c.name} | ${r.liqPerMatch.toFixed(2)} | ${pct(r.pct1to3)} | ${pct(r.pctZero)} | ${pct(r.greedyPopped)} | ${pct(r.greedyEaten)} | ${pct(r.greedyLost)} | ${r.popsByDrone} | ${r.keeper} |`);
    process.stderr.write(rows.at(-1) + "\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`${n} matches per config (half paid 6 players + 2 drones, half free 12 agents), 1 greedy player each`);
console.log("| config | liquidations/match | matches with 1 to 3 | matches with 0 | greedy popped | greedy eaten | greedy ends below entry | drone pops | keeper pops |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
