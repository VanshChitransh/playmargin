// Tunnel mode front proxy (what ops/Caddyfile does on the droplet, minus TLS, which Cloudflare does).
// cloudflared -> 127.0.0.1:8700 -> /relay/* to the relayer (prefix stripped), everything else (HTTP and
// WebSocket) to the game server. The client IP comes from CF-Connecting-IP, which Cloudflare's edge sets
// and overwrites; any X-Real-IP / X-Forwarded-For a client sent is dropped. Listens on loopback only, so
// nothing but cloudflared on this Mac can reach it (and so nobody can forge CF-Connecting-IP).
import http from "node:http";
import net from "node:net";

const LISTEN = Number(process.env.PROXY_PORT ?? 8700);
const GAME = Number(process.env.GAME_PORT ?? 2700);
const RELAY = Number(process.env.RELAY_PORT ?? 3700);

function route(url) {
  if (url === "/relay" || url.startsWith("/relay/") || url.startsWith("/relay?")) return { port: RELAY, path: url.slice("/relay".length) || "/" };
  return { port: GAME, path: url };
}

function headers(req) {
  const h = { ...req.headers };
  const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
  delete h["x-real-ip"];
  delete h["x-forwarded-for"];
  delete h["x-client-ip"];
  h["x-real-ip"] = ip;
  h["x-forwarded-for"] = ip;
  h["x-forwarded-proto"] = "https";
  return h;
}

const server = http.createServer((req, res) => {
  const { port, path } = route(req.url ?? "/");
  const up = http.request({ host: "127.0.0.1", port, method: req.method, path, headers: headers(req) }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: port === RELAY ? "relayer unavailable" : "game server unavailable" }));
  });
  req.pipe(up);
});

// WebSocket upgrades: replay the request line and cleaned headers to the game server, then splice.
server.on("upgrade", (req, socket, head) => {
  const { port, path } = route(req.url ?? "/");
  const up = net.connect(port, "127.0.0.1", () => {
    const h = headers(req);
    const lines = [`${req.method} ${path} HTTP/1.1`, ...Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]))];
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const close = () => (up.destroy(), socket.destroy());
  up.on("error", close);
  socket.on("error", close);
});

server.listen(LISTEN, "127.0.0.1", () => console.log(`proxy 127.0.0.1:${LISTEN} -> game :${GAME}, /relay -> :${RELAY}`));
