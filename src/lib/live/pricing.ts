// Decoder for Yahoo Finance's streaming price messages (base64 protobuf,
// "PricingData"). Only the fields Installous uses are read; the rest are skipped.

export enum MarketHours {
  PreMarket = 0,
  Regular = 1,
  PostMarket = 2,
  Extended = 3,
  Overnight = 4,
}

export function sessionLabel(h: MarketHours | null): string | null {
  switch (h) {
    case MarketHours.Regular:
      return null;
    case MarketHours.PreMarket:
      return "Pre-market";
    case MarketHours.PostMarket:
      return "After hours";
    case MarketHours.Overnight:
      return "Overnight";
    default:
      return "Extended hours";
  }
}

export interface PriceTick {
  ticker: string;
  price: number;
  /** Epoch ms of the trade. */
  time: number;
  marketHours: MarketHours | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode one message; returns null for anything malformed or without a price. */
export function decodePricing(b64: string): PriceTick | null {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64.trim());
  } catch {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;

  // Varints here fit in a double (times are ~2^42 after zigzag), so plain math is safe.
  const varint = (): number => {
    let result = 0;
    let scale = 1;
    for (;;) {
      if (pos >= bytes.length) throw new Error("truncated");
      const b = bytes[pos++];
      result += (b & 0x7f) * scale;
      if (b < 0x80) return result;
      scale *= 128;
      if (scale > 2 ** 63) throw new Error("varint too long");
    }
  };
  const zigzag = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

  const tick: Partial<PriceTick> = { marketHours: null, change: null, changePercent: null, previousClose: null };
  try {
    while (pos < bytes.length) {
      const key = varint();
      const field = Math.floor(key / 8);
      const wire = key & 7;
      if (wire === 0) {
        const v = varint();
        if (field === 3) tick.time = zigzag(v);
        else if (field === 7) tick.marketHours = v as MarketHours;
      } else if (wire === 5) {
        if (pos + 4 > bytes.length) throw new Error("truncated");
        const f = view.getFloat32(pos, true);
        pos += 4;
        if (field === 2) tick.price = f;
        else if (field === 8) tick.changePercent = f;
        else if (field === 12) tick.change = f;
        else if (field === 16) tick.previousClose = f;
      } else if (wire === 2) {
        const len = varint();
        if (pos + len > bytes.length) throw new Error("truncated");
        if (field === 1) tick.ticker = new TextDecoder().decode(bytes.subarray(pos, pos + len));
        pos += len;
      } else if (wire === 1) {
        pos += 8;
      } else {
        throw new Error(`unsupported wire type ${wire}`);
      }
    }
  } catch {
    return null;
  }
  if (!tick.ticker || typeof tick.price !== "number" || !Number.isFinite(tick.price) || tick.price <= 0) return null;
  return { time: Date.now(), ...tick } as PriceTick;
}
