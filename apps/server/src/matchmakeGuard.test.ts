// QA-A-04 / QA-A-03: reservations are limited per IP and bad bodies get JSON, everything else passes.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { guardMatchmake } from "./matchmakeGuard";
import { RateLimiter } from "./rooms/guard";

let srv: Server;
let seen: Array<{ url: string; body: unknown }> = [];
afterEach(() => srv?.close());

/** A stand-in for the Colyseus router: echoes what it received, including a pre-read body. */
async function start(max = 3): Promise<string> {
  seen = [];
  srv = createServer((req: IncomingMessage & { body?: unknown }, res) => {
    seen.push({ url: req.url ?? "", body: req.body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  guardMatchmake(srv, new RateLimiter(max, 60_000));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
}
const post = (base: string, body: string, ip = "1.2.3.4") =>
  fetch(`${base}/matchmake/joinOrCreate/match`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body });

describe("guardMatchmake", () => {
  it("passes a good reservation through with its body pre-read for Colyseus", async () => {
    const base = await start();
    const r = await post(base, '{"mode":"free"}');
    expect(r.status).toBe(200);
    expect(seen).toEqual([{ url: "/matchmake/joinOrCreate/match", body: { mode: "free" } }]);
  });

  it("refuses an IP over the limit with JSON 429 and CORS, other IPs and other routes still pass", async () => {
    const base = await start(3);
    for (let i = 0; i < 3; i++) expect((await post(base, "{}")).status).toBe(200);
    const r = await post(base, "{}");
    expect(r.status).toBe(429);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(await r.json()).toEqual({ code: 429, error: "too many joins, slow down" });
    expect((await post(base, "{}", "5.6.7.8")).status).toBe(200);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("answers JSON 400 for a body that is not a JSON object (was an empty 500)", async () => {
    const base = await start();
    for (const bad of ["not json", "[1,2]", "42"]) {
      const r = await post(base, bad);
      expect(r.status).toBe(400);
      expect((await r.json()) as { error: string }).toEqual({ code: 400, error: "join options must be a JSON object" });
    }
    expect(seen).toHaveLength(0);
  });

  it("refuses join options over 8 KB with 413", async () => {
    const base = await start();
    const r = await post(base, JSON.stringify({ mode: "free", name: "n".repeat(20_000) }));
    expect(r.status).toBe(413);
    expect(seen).toHaveLength(0);
  });
});
