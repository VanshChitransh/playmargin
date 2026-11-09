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

const C = { ink: "#070A12", paper: "#EEF2FF", liq: "#FF3D5A", gold: "#F5B83D", agent: "#3BE3FF", muted: "#8391B3" };
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

  g.fillStyle = C.liq;
  g.fillRect(0, 0, W, H);
  text("MARGIN", 70, 120, "64px 'Lilita One'", C.paper, "left", 14);
  text("LIQUIDATION CERTIFICATE", W - 70, 110, "600 30px 'JetBrains Mono'", C.ink, "right");

  // Stamp
  g.save();
  g.translate(W / 2, 290);
  g.rotate(-0.06);
  g.lineWidth = 14;
  g.strokeStyle = C.ink;
  g.fillStyle = C.paper;
  g.beginPath();
  g.roundRect(-400, -95, 800, 170, 26);
  g.fill();
  g.stroke();
  text("LIQUIDATED", 0, 45, "130px 'Lilita One'", C.liq, "center");
  g.restore();

  // Rekt + who did it
  sticker(70, 450, 300, 300, C.ink);
  const rekt = new Image();
  rekt.src = "/brand/rekt.png";
  await rekt.decode().catch(() => {});
  if (rekt.complete && rekt.naturalWidth) g.drawImage(rekt, 80, 460, 280, 280);
  const agent = /^(agent|drone)/i.test(d.by);
  text(d.keeper ? "Closed by" : "Popped by", 420, 510, "600 30px 'JetBrains Mono'", C.ink);
  text(d.keeper ? "THE VAULT" : d.by, 420, 590, "72px 'Lilita One'", d.keeper ? C.paper : agent ? C.agent : C.paper, "left", 14);
  if (agent) text("an AI agent with its own NEAR account", 420, 640, "500 28px Rubik", C.ink);

  // Numbers
  sticker(70, 800, W - 140, 270, C.paper);
  const stat = (label: string, value: string, x: number): void => {
    text(label, x, 870, "600 26px 'JetBrains Mono'", C.muted, "center");
    text(value, x, 960, "78px 'Lilita One'", C.ink, "center");
  };
  stat("LEVERAGE", `${d.leverage.toFixed(1)}x`, 240);
  stat("RED FOR", `${Math.max(0, d.redS).toFixed(0)} s`, W / 2);
  stat("GREED", `${greedScore(d.peakLeverage)}/100`, W - 240);
  const hint = d.warnAtS !== null ? `Should have hit REPAY at ${clock(R.MATCH_S - d.warnAtS)}.` : "Never saw it coming.";
  text(hint, W / 2, 1035, "500 34px Rubik", C.ink, "center");

  // Footer: line + QR to verify
  text("Get greedy.", 70, 1205, "76px 'Lilita One'", C.paper, "left", 14);
  text("Get liquidated.", 70, 1285, "76px 'Lilita One'", C.paper, "left", 14);
  const qr = encode(verifyUrl(d.matchId), { border: 1 });
  const n = qr.data.length;
  const size = 180;
  const cell = size / n;
  const qx = W - 70 - size;
  const qy = 1120;
  sticker(qx - 10, qy - 10, size + 20, size + 20, C.paper, 12);
  g.fillStyle = C.ink;
  qr.data.forEach((row, y) => row.forEach((on, x) => on && g.fillRect(qx + x * cell, qy + y * cell, Math.ceil(cell), Math.ceil(cell))));
  text("scan to verify", qx + size / 2, qy + size + 38, "600 22px 'JetBrains Mono'", C.ink, "center");

  return new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error("canvas export failed"))), "image/png"));
}

/** Native share sheet with the PNG when the browser can, else a download. */
export async function shareCertificate(d: CertData): Promise<void> {
  const blob = await drawCertificate(d);
  const file = new File([blob], `margin-liquidated-${d.matchId}.png`, { type: "image/png" });
  const data = { files: [file], text: `Got greedy. Got liquidated at ${d.leverage.toFixed(1)}x on MARGIN.`, url: verifyUrl(d.matchId) };
  if (navigator.canShare?.(data)) {
    try {
      return await navigator.share(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
