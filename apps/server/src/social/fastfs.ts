// FastFS upload payload (near.social/skill.md section 4): one borsh FastfsData::Simple for files up
// to 1 MiB, sent as raw args of "__fastdata_fastfs" to "social". Content addressed by sha256.
import { createHash } from "node:crypto";

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const str = (x: Buffer): Buffer => Buffer.concat([u32(x.length), x]);

/** Borsh Simple payload plus the media path it lands at (media/<sha256>.<ext>). */
export function fastfsSimple(data: Buffer, mime: string, ext: string): { path: string; payload: Buffer } {
  if (data.length > 1 << 20) throw new Error("FastFS Simple upload is 1 MiB at most");
  const path = `media/${createHash("sha256").update(data).digest("hex")}.${ext}`;
  // variant 0 = Simple, then path, Some(content) = 1, mime, bytes
  const payload = Buffer.concat([Buffer.from([0]), str(Buffer.from(path)), Buffer.from([1]), str(Buffer.from(mime)), str(data)]);
  return { path, payload };
}
