// npm run proofs: every tx cited in README.md and docs/NEAR.md, read straight from NEAR RPC (no keys),
// because nearblocks answers automated clients with a Cloudflare 403. One OK line per tx with
// signer, receiver, method and its key arg or event. Exits 1 if any tx is missing or failed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nearClients, withFallback } from "../../apps/client/src/chain/rpc.ts";

type Network = "testnet" | "mainnet";
type Action = string | Record<string, Record<string, unknown>>;
type Outcome = { logs: string[]; status: Record<string, unknown> };
type Tx = {
  status: Record<string, unknown>;
  transaction: { signer_id: string; receiver_id: string; actions: Action[] };
  receipts_outcome: { outcome: Outcome }[];
};

const root = join(import.meta.dirname, "../..");
const docs = ["README.md", "docs/NEAR.md"].map((f) => readFileSync(join(root, f), "utf8")).join("\n");
const cited = [...docs.matchAll(/https:\/\/(testnet\.)?nearblocks\.io\/txns\/([1-9A-HJ-NP-Za-km-z]{43,44})/g)];
// `npm run proofs -- <hash> ...` checks given testnet hashes instead (e.g. a new settle).
const given = process.argv.slice(2).filter((h) => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h));
const txs: [string, Network][] = given.length
  ? given.map((h) => [h, "testnet"])
  : [...new Map(cited.map((m) => [m[2]!, (m[1] ? "testnet" : "mainnet") as Network])).entries()];
const clients = { testnet: nearClients("testnet"), mainnet: nearClients("mainnet") };
// tx lookup needs an account only to route to its shard; any of ours works on these RPCs.
const route = { testnet: "playmargin.testnet", mainnet: "vanshverse.near" };

const short = (v: unknown, n = 110) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}...` : s;
};

/** The method (or action kind) and a one-line summary of its args and the contract's own event. */
function describe(tx: Tx): { method: string; detail: string } {
  // The first function call carries the story (deploy + migrate shows migrate).
  let a = tx.transaction.actions.find((x) => typeof x === "object" && (x.FunctionCall || x.Delegate)) ?? tx.transaction.actions[0]!;
  const delegate = typeof a === "object" && a.Delegate ? "via relayer: " : "";
  if (delegate) a = ((a as { Delegate: { delegate_action: { actions: Action[] } } }).Delegate.delegate_action.actions[0])!;
  const kinds = tx.transaction.actions.map((x) => (typeof x === "string" ? x : Object.keys(x)[0]!));
  const event = tx.receipts_outcome
    .flatMap((r) => r.outcome.logs)
    .find((l) => l.startsWith("EVENT_JSON:") && l.includes('"standard":"margin"'));
  const ev = event ? (JSON.parse(event.slice(11)) as { event: string; data: unknown }) : null;
  if (typeof a === "object" && a.FunctionCall) {
    const fc = a.FunctionCall as { method_name: string; args: string };
    const args = Buffer.from(fc.args, "base64").toString();
    const call = tx.transaction.actions.length > 1 ? `${kinds.join("+")} ${fc.method_name}` : fc.method_name;
    return { method: call, detail: `${delegate}args ${short(args)}${ev ? ` | event ${ev.event} ${short(ev.data, 90)}` : ""}` };
  }
  if (typeof a === "object" && a.AddKey) return { method: "AddKey", detail: short((a.AddKey as { access_key: unknown }).access_key) };
  return { method: kinds.join("+"), detail: `to ${tx.transaction.receiver_id}` };
}

let bad = 0;
for (const [hash, network] of txs) {
  try {
    const tx = await withFallback(clients[network], (near) =>
      near.rpc.call<Tx>("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: route[network], wait_until: "FINAL" }),
    );
    const ok = "SuccessValue" in tx.status || "SuccessReceiptId" in tx.status;
    const { method, detail } = describe(tx);
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "FAIL"} ${network} ${hash.slice(0, 8)} ${tx.transaction.signer_id} -> ${tx.transaction.receiver_id} ${method} | ${detail}`);
  } catch (err) {
    bad++;
    console.log(`FAIL ${network} ${hash} ${short(String(err), 140)}`);
  }
}
console.log(`${txs.length - bad} of ${txs.length} cited txs OK on chain (read from NEAR RPC, not nearblocks)`);
process.exit(bad === 0 && txs.length > 0 ? 0 : 1);
