// Liquidation Certificate: a 1080x1350 PNG drawn on a canvas (html-to-image breaks on iOS),
// shared with navigator.share({files}) or downloaded. Every number comes from the match the
// player just lost, and the QR opens /verify for that match so anyone can check it.
import { encode } from "uqr";
import { R } from "@margin/core";
import type { Outcome } from "../game/receipt";

type Death = NonNullable<Outcome["death"]>;
export interface CertData extends Death {
  matchId: string;
}

// Arcade Paper tokens (style.css): the card people share must look like the site.
const C = { ink: "#1B1A2E", paper: "#FFF6E6", card: "#FFFFFF", liq: "#E5484D", warn: "#FFD43B", agent: "#3BE3FF", muted: "#4A4760", sky: "#7CC8FF", dot: "rgba(27,26,46,.10)" };
const W = 1080;
const H = 1350;

/** 0 to 100: how close to the 2.5x cap you flew at your greediest. */
export const greedScore = (peakLeverage: number): number => Math.round(Math.min(100, Math.max(0, ((peakLeverage - 1) / 1.5) * 100)));

/** m:ss, like the HUD clock (which counts the time left). */
export const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export const verifyUrl = (matchId: string): string => `${location.origin}/#/verify/${encodeURIComponent(matchId)}`;

/** The certificate as a PNG blob. */
export async function drawCertificate(d: CertData): Promise<Blob> {
  await document.fonts.ready;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const sticker = (x: number, y: number, w: number, h: number, fill: string, r = 28): void => {
    g.fillStyle = C.ink;
    g.beginPath();
    g.roundRect(x + 12, y + 12, w, h, r);
    g.fill();
    g.fillStyle = fill;
    g.lineWidth = 8;
    g.strokeStyle = C.ink;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
    g.stroke();
  };
  const text = (t: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = "left", outline = 0): void => {
    g.font = font;
    g.textAlign = align;
    g.lineJoin = "round";
    if (outline) {
      g.lineWidth = outline;
      g.strokeStyle = C.ink;
      g.strokeText(t, x, y);
    }
    g.fillStyle = fill;
    g.fillText(t, x, y);
  };

  const img = async (src: string): Promise<HTMLImageElement | null> => {
    const i = new Image();
    i.src = src;
    await i.decode().catch(() => {});
    return i.complete && i.naturalWidth ? i : null;
  };

  // Cream paper with the site's dot grid.
  g.fillStyle = C.paper;
  g.fillRect(0, 0, W, H);
  g.fillStyle = C.dot;
  for (let y = 14; y < H; y += 28) for (let x = 14; x < W; x += 28) g.fillRect(x, y, 3, 3);

  // Header: the cat on a sky tile + wordmark, certificate tag on the right.
  sticker(70, 52, 96, 96, C.sky, 24);
  const cat = await img("/brand/margin-cat-cutout.svg");
  if (cat) {
    g.save();
    g.beginPath();
    g.roundRect(70, 52, 96, 96, 24);
    g.clip();
    g.drawImage(cat, 64, 62, 108, 108);
    g.restore();
    g.lineWidth = 8;
    g.strokeStyle = C.ink;
    g.beginPath();
    g.roundRect(70, 52, 96, 96, 24);
    g.stroke();
  }
  text("MARGIN", 190, 124, "68px 'Lilita One'", C.ink);
  sticker(W - 70 - 390, 70, 390, 64, C.warn, 32);
  text("LIQUIDATION CERTIFICATE", W - 70 - 195, 113, "700 24px 'JetBrains Mono'", C.ink, "center");

  // Stamp: red ink on white, slightly crooked, sticker shadow.
  g.save();
  g.translate(W / 2, 300);
  g.rotate(-0.06);
  g.fillStyle = C.ink;
  g.beginPath();
  g.roundRect(-388, -83, 800, 170, 26);
  g.fill();
  g.lineWidth = 14;
  g.strokeStyle = C.liq;
  g.fillStyle = C.card;
  g.beginPath();
  g.roundRect(-400, -95, 800, 170, 26);
  g.fill();
  g.stroke();
  text("LIQUIDATED", 0, 45, "130px 'Lilita One'", C.liq, "center");
  g.restore();

  // Rekt + who did it.
  sticker(70, 470, 290, 290, C.ink);
  const rekt = await img("/brand/rekt.png");
  if (rekt) {
    g.save();
    g.beginPath();
    g.roundRect(74, 474, 282, 282, 24);
    g.clip();
    g.drawImage(rekt, 74, 474, 282, 282);
    g.restore();
  }
  const agent = /^(agent|drone)/i.test(d.by);
  text(d.keeper ? "Closed by" : "Popped by", 410, 530, "600 30px 'JetBrains Mono'", C.muted);
  text(d.keeper ? "THE VAULT" : d.by, 410, 612, "76px 'Lilita One'", C.ink);
  if (agent) {
    sticker(410, 652, 600, 60, C.agent, 30);
    text("an AI agent with its own NEAR account", 710, 692, "600 26px Rubik", C.ink, "center");
  }

  // Numbers.
  sticker(70, 810, W - 140, 270, C.card);
  const stat = (label: string, value: string, x: number, fill: string = C.ink): void => {
    text(label, x, 880, "600 26px 'JetBrains Mono'", C.muted, "center");
    text(value, x, 970, "80px 'Lilita One'", fill, "center");
  };
  stat("LEVERAGE", `${d.leverage.toFixed(1)}x`, 240);
  // A drone can pop a blob the instant it goes red: say "<1 s", never a bare "0 s".
  stat("RED FOR", d.redS < 0.5 ? "<1 s" : `${Math.round(d.redS)} s`, W / 2, C.liq);
  stat("GREED", `${greedScore(d.peakLeverage)}/100`, W - 240);
  const hint = d.warnAtS !== null ? `Should have held REPAY at ${clock(R.MATCH_S - d.warnAtS)}.` : "Never saw it coming.";
  text(hint, W / 2, 1042, "500 34px Rubik", C.ink, "center");

  // Footer: the line + QR to verify.
  text("Get greedy.", 70, 1212, "80px 'Lilita One'", C.ink);
  text("Get liquidated.", 70, 1292, "80px 'Lilita One'", C.liq);
  const qr = encode(verifyUrl(d.matchId), { border: 1 });
  const n = qr.data.length;
  const size = 170;
  const cell = size / n;
  const qx = W - 80 - size;
  const qy = 1122;
  sticker(qx - 10, qy - 10, size + 20, size + 20, C.card, 12);
  g.fillStyle = C.ink;
  qr.data.forEach((row, y) => row.forEach((on, x) => on && g.fillRect(qx + x * cell, qy + y * cell, Math.ceil(cell), Math.ceil(cell))));
  text("scan to verify", qx + size / 2, qy + size + 44, "600 22px 'JetBrains Mono'", C.ink, "center");

  return new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error("canvas export failed"))), "image/png"));
}

/**
 * Show the certificate itself, then let the player save, share or copy the link. Desktop
 * share sheets (macOS) show only the URL and hide the image, so the card is never skipped.
 */
export async function shareCertificate(d: CertData): Promise<void> {
  const blob = await drawCertificate(d);
  const file = new File([blob], `margin-liquidated-${d.matchId}.png`, { type: "image/png" });
  const src = URL.createObjectURL(blob);
  const link = verifyUrl(d.matchId);
  const text = `Got greedy. Got liquidated at ${d.leverage.toFixed(1)}x on MARGIN. ${link}`;
  // Files only: with a url too, macOS shares just the link.
  const canShare = !!navigator.canShare?.({ files: [file] });
  const b = (act: string, label: string, fill: string): string =>
    `<button data-act="${act}" class="sticker sticker-press h-12 rounded-box px-4 font-display text-lg text-ink" style="background:${fill}">${label}</button>`;
  const el = document.createElement("div");
  el.className = "fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-ink/80 p-4";
  el.innerHTML = `<div class="flex w-full max-w-sm flex-col gap-3">
      <img src="${src}" alt="Liquidation Certificate" class="sticker mx-auto max-h-[62vh] w-auto max-w-full rounded-box" />
      <div class="grid grid-cols-2 gap-3">${b("save", "Save image", "var(--color-warn)")}${canShare ? b("share", "Share", "var(--color-safe)") : b("copy", "Copy link", "#fff")}</div>
      ${canShare ? b("copy", "Copy link", "#fff") : ""}
      ${b("close", "Close", "#fff")}
    </div>`;
  const close = (): void => {
    el.remove();
    URL.revokeObjectURL(src);
  };
  el.addEventListener("click", async (e) => {
    if (e.target === el) return close();
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") return close();
    if (act === "save") {
      const a = document.createElement("a");
      a.href = src;
      a.download = file.name;
      a.click();
    } else if (act === "share") {
      await navigator.share({ files: [file], text }).catch(() => {}); // cancel is fine
    } else if (act === "copy") {
      const ok = await navigator.clipboard.writeText(link).then(() => true, () => false);
      btn.textContent = ok ? "Link copied" : link;
    }
  });
  document.body.appendChild(el);
}
