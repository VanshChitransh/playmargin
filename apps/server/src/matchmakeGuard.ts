// In front of the Colyseus router: POST /matchmake/* (seat reservations) never reached our join limit,
// which runs at the websocket onAuth, AFTER a seat already exists. One script could hold every seat
// with bare POSTs and lock players out (QA-A-04). This hook limits reservations per IP and answers a
// bad body with JSON (QA-A-03) instead of Colyseus's empty 500. Every other request passes through.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { RateLimiter } from "./rooms/guard";

/** Max request body for a reservation: join options are a few small strings. */
const MAX_BODY = 8 * 1024;

function reply(res: ServerResponse, status: number, error: string): void {
  // CORS too, or the browser hides the reason and the client mistakes a refusal for "offline".
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify({ code: status, error }));
}

/** The caller's IP: X-Real-IP from Caddy (it overwrites any client value), else the socket. */
export function requestIp(req: IncomingMessage): string {
  const h = req.headers["x-real-ip"];
  return (Array.isArray(h) ? h[0] : h)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

/**
 * Wraps the server's request listeners (the Colyseus router) with the reservation guard. Call after
 * listen(), once Colyseus has bound its router. 30 reservations a minute per IP: a player needs about
 * one per match, and a hostel or office behind one IP still fits several friends.
 */
export function guardMatchmake(server: Server, limiter = new RateLimiter(Number(process.env.MATCHMAKE_LIMIT_PER_MIN ?? 30), 60_000)): void {
  const listeners = server.listeners("request") as Array<(req: IncomingMessage, res: ServerResponse) => void>;
  server.removeAllListeners("request");
  const pass = (req: IncomingMessage, res: ServerResponse) => listeners.forEach((l) => l.call(server, req, res));
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || !req.url?.startsWith("/matchmake/")) return pass(req, res);
    if (!limiter.allow(requestIp(req))) return reply(res, 429, "too many joins, slow down");
    let size = 0;
    const chunks: Buffer[] = [];
    let done = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY && !done) {
        done = true;
        reply(res, 413, "join options too large");
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        const body: unknown = raw ? JSON.parse(raw) : {};
        if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("not an object");
        // Colyseus reads a pre-read body from req.body (better-call getRequest), so the stream is not needed again.
        (req as IncomingMessage & { body?: unknown }).body = body;
      } catch {
        return reply(res, 400, "join options must be a JSON object");
      }
      pass(req, res);
    });
  });
}
