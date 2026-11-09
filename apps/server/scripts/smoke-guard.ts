// S12 gate against a live server started with MAX_ROOMS=2: a 3rd room is refused, the 13th join
// in a minute from one IP is refused, and /api/credits answers 429 after 30 calls.
// Usage: MAX_ROOMS=2 PORT=2611 npx tsx src/index.ts, then npx tsx apps/server/scripts/smoke-guard.ts http://localhost:2611
import { Client } from "@colyseus/sdk";

const base = process.argv[2] ?? "http://localhost:2567";
const sdk = new Client(base.replace(/^http/, "ws"));
const RUN = Date.now().toString(36);
const tryJoin = (name: string, code: string, i: number) =>
  sdk.joinOrCreate(name, { mode: "free", roomCode: code, guestKey: `ed25519:guard${RUN}k${i}` }).then(
    (r) => (r.onMessage("ev", () => {}), r.onMessage("me", () => {}), "ok"),
    (e: Error) => e.message,
  );
const caps = [await tryJoin("private", "AAAA", 1), await tryJoin("private", "BBBB", 2), await tryJoin("private", "CCCC", 3)];
const joins: string[] = [];
for (let i = 4; i < 16; i++) joins.push(await tryJoin("private", "AAAA", i));
const credits: number[] = [];
for (let i = 0; i < 31; i++) credits.push((await fetch(`${base}/api/credits?guestKey=ed25519:guardcred${RUN}${i}`)).status);
const r = { caps, joinsOk: joins.filter((j) => j === "ok").length, lastJoin: joins.at(-1), credits429: credits.filter((c) => c === 429).length };
console.log(r);
// The refused 3rd room never reaches onAuth, so 2 + 10 joins = 12 allowed and the 13th is limited. 31st credits call is limited.
const ok = caps[0] === "ok" && caps[1] === "ok" && /full/.test(caps[2]!) && r.joinsOk === 10 && /too many/.test(r.lastJoin!) && r.credits429 === 1;
console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
