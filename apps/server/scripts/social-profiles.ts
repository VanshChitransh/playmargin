// Deploy day (MAINNET-RUNBOOK): give the house contract and its liquidator drones real near.social
// profiles (name, "automated" about, website, avatar on FastFS), so a judge can click any agent and
// see who it is. near.social is mainnet only. Dry run by default: prints every write, sends nothing.
// Usage: npx tsx apps/server/scripts/social-profiles.ts --contract playmargin.near [--drones 3] [--send]
// Keys: ~/.near-credentials/mainnet/<account>.json for the contract and each drone-N.<contract>.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FileKeyStore } from "near-kit/keys/file";
import { Near } from "near-kit";
import { fastfsSimple } from "../src/social/fastfs";

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const contract = arg("contract");
const drones = Number(arg("drones") ?? 3);
const send = process.argv.includes("--send");
const SITE = "https://playmargin.fun";
if (!contract) throw new Error("pass --contract <mainnet contract account>, e.g. playmargin.near");
if (!contract.endsWith(".near")) throw new Error("near.social is mainnet only: --contract must be a .near account");

const assets = join(import.meta.dirname, "social-assets");
const profiles = [
  { account: contract, image: "margin.png", name: "MARGIN", about: `The MARGIN arena contract: a 90-second game where BOOST is a loan from a vault and the greedy get liquidated. Holds tickets and settles every paid match. Automated account. ${SITE}` },
  ...Array.from({ length: drones }, (_, i) => ({
    account: `drone-${i + 1}.${contract}`,
    image: "agent3.png",
    name: `MARGIN Drone-${i + 1}`,
    about: `MARGIN AI liquidator agent, wallet drone-${i + 1}. Pops players who stay red and earns a capped bounty. Automated account. ${SITE}`,
  })),
];

const near = new Near({ network: "mainnet", keyStore: new FileKeyStore(join(homedir(), ".near-credentials"), "mainnet") });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "social" has no contract, so every receipt fails by design: the indexer is the verdict. */
async function write(signerId: string, method: "__fastdata_kv" | "__fastdata_fastfs", args: object | Uint8Array): Promise<void> {
  await near.call("social", method, args, { signerId, gas: "1000000000", attachedDeposit: 0n }).catch(() => undefined);
}

async function until(what: string, ok: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (await ok().catch(() => false)) return;
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

for (const p of profiles) {
  const { path, payload } = fastfsSimple(readFileSync(join(assets, p.image)), "image/png", "png");
  const kv = { "profile/name": p.name, "profile/about": p.about, "profile/links/website": SITE, "profile/avatar": `fastfs://${p.account}/social/${path}` };
  console.log(JSON.stringify({ account: p.account, avatarBytes: payload.length, kv }));
  if (!send) continue;
  await write(p.account, "__fastdata_fastfs", new Uint8Array(payload));
  // Probe with ?v= so the CDN never caches a 404 for the final URL (skill.md).
  await until(`${p.account} avatar on FastFS`, async () => (await fetch(`https://main.fastfs.io/${p.account}/social/${path}?v=${Date.now()}`)).ok);
  await write(p.account, "__fastdata_kv", kv);
  await until(`${p.account} profile on near.social`, async () => {
    const j = (await (await fetch(`https://api2.near.social/v1/accounts/${p.account}`)).json()) as { name?: string; avatar_url?: string | null };
    return j.name === p.name && !!j.avatar_url;
  });
  console.log(`OK https://near.social/${p.account}`);
}
if (!send) console.log("dry run: nothing sent. Add --send on deploy day (mainnet, Vansh's go-ahead).");
