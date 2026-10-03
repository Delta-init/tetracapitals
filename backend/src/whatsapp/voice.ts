import prism from "prism-media";

/* ────────────────────────────────────────────────────────────────────────────
   A voice note recorded in the browser, made into what WhatsApp sends as one:
   Opus audio in an Ogg file. Firefox records that already. Chrome, Edge and a
   current Safari record Opus in WebM — the same sound, another wrapping — so
   the packets are taken out of the WebM (prism-media) and laid into Ogg pages
   here (RFC 7845: an OpusHead page, an OpusTags page, then the audio), without
   decoding anything. Anything else (an older Safari's MP4) is not a voice
   note; it goes as an ordinary audio file.
──────────────────────────────────────────────────────────────────────────── */

export const VOICE_MIME = "audio/ogg; codecs=opus";
const PACKETS_PER_PAGE = 50;   // about a second of speech a page

/** The Ogg checksum: CRC-32, polynomial 0x04C11DB7, not reflected, starting from 0. */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();
function crc(page: Buffer): number {
  let c = 0;
  for (const b of page) c = ((c << 8) ^ CRC[((c >>> 24) ^ b) & 0xff]!) >>> 0;
  return c;
}

/** One Ogg page holding whole packets. flags: 2 = first page, 4 = last page. */
function page(packets: Buffer[], granule: bigint, serial: number, sequence: number, flags: number): Buffer {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    for (; n >= 255; n -= 255) lacing.push(255);
    lacing.push(n);
  }
  const head = Buffer.alloc(27 + lacing.length);
  head.write("OggS", 0, "ascii");
  head[5] = flags;
  head.writeBigInt64LE(granule, 6);
  head.writeUInt32LE(serial, 14);
  head.writeUInt32LE(sequence, 18);
  head[26] = lacing.length;
  lacing.forEach((v, i) => (head[27 + i] = v));
  const out = Buffer.concat([head, ...packets]);
  out.writeUInt32LE(crc(out), 22);
  return out;
}

/** How many 48 kHz samples an Opus packet holds, from its first byte (RFC 6716, 3.1). */
function samplesOf(packet: Buffer): number {
  if (!packet.length) return 0;
  const toc = packet[0]!;
  const config = toc >> 3;
  const ms = config < 12 ? [10, 20, 40, 60][config & 3]! : config < 16 ? [10, 20][config & 1]! : [2.5, 5, 10, 20][config & 3]!;
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return Math.round(ms * 48 * frames);
}

/** The Opus packets in a WebM recording, and its OpusHead when the WebM carries one. */
function fromWebm(webm: Buffer): Promise<{ head: Buffer | null; packets: Buffer[] }> {
  return new Promise((resolve, reject) => {
    const demuxer = new prism.opus.WebmDemuxer();
    const packets: Buffer[] = [];
    let head: Buffer | null = null;
    demuxer.on("head", (h: Buffer) => { head = Buffer.from(h); });
    demuxer.on("data", (p: Buffer) => packets.push(Buffer.from(p)));
    demuxer.on("error", reject);
    demuxer.on("end", () => resolve({ head, packets }));
    demuxer.end(webm);
  });
}

/** Opus packets as an Ogg Opus file. */
function toOgg(head: Buffer | null, packets: Buffer[]): Buffer {
  const opusHead = head && head.subarray(0, 8).toString("ascii") === "OpusHead" ? head : (() => {
    const h = Buffer.alloc(19);
    h.write("OpusHead", 0, "ascii");
    h[8] = 1;                       // version
    h[9] = 1;                       // one channel: a voice
    h.writeUInt16LE(312, 10);       // pre-skip, as browsers' encoders use
    h.writeUInt32LE(48000, 12);     // input sample rate
    return h;                       // no gain, mapping family 0
  })();
  const vendor = Buffer.from("Delta portal", "utf8");
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write("OpusTags", 0, "ascii");
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  // and no comments: the last four bytes stay 0

  const serial = Math.floor(Math.random() * 0xffffffff) >>> 0;
  const pages = [page([opusHead], 0n, serial, 0, 2), page([tags], 0n, serial, 1, 0)];
  let granule = 0n;
  for (let i = 0; i < packets.length; i += PACKETS_PER_PAGE) {
    const group = packets.slice(i, i + PACKETS_PER_PAGE);
    for (const p of group) granule += BigInt(samplesOf(p));
    pages.push(page(group, granule, serial, pages.length, i + PACKETS_PER_PAGE >= packets.length ? 4 : 0));
  }
  return Buffer.concat(pages);
}

/**
 * A recording as a WhatsApp voice note, or null when it can't be one (not Opus): Ogg Opus as it is, WebM Opus
 * re-wrapped as Ogg Opus.
 */
export async function asVoiceNote(audio: Buffer, mime: string): Promise<Buffer | null> {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  if (type === "audio/ogg" || type === "application/ogg") return audio;
  if (type !== "audio/webm" && type !== "video/webm") return null;
  const { head, packets } = await fromWebm(audio);
  if (!packets.length) throw new Error("The recording had no sound in it");
  return toOgg(head, packets);
}
