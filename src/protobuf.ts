/**
 * A minimal protobuf codec.
 *
 * Only what the Lens endpoint needs: varints, length-delimited fields and
 * fixed32 floats. A full runtime costs ~24 kB gzipped here because its
 * descriptors cannot be tree-shaken, which is a lot for a script that parses on
 * every page load. Field numbers still come from the real .proto files — see
 * `gen/fields.ts` and `scripts/gen-fields.ts`.
 *
 * The reader is schema-less by design: it returns `{ fieldNumber: [values] }`
 * and callers navigate it with the helpers at the bottom, so reading one more
 * field costs one line at the call site.
 */

import type { Bytes } from './types.js';

export const Wire = {
  Varint: 0,
  Fixed64: 1,
  Length: 2,
  Fixed32: 5,
} as const;
export type Wire = (typeof Wire)[keyof typeof Wire];

/** A decoded value, before the caller decides what it meant. */
export type PbValue = bigint | number | Bytes;
/** A decoded message: field number to the values seen for it. */
export type PbMessage = Record<number, PbValue[] | undefined>;

function encodeVarint(value: bigint | number): number[] {
  let v = BigInt(value);
  const out: number[] = [];
  while (v > 127n) {
    out.push(Number(v & 127n) | 128);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

export interface Writer {
  raw(bytes: ArrayLike<number>): Writer;
  tag(field: number, wire: Wire): Writer;
  int(field: number, value: bigint | number | undefined): Writer;
  str(field: number, value: string | undefined): Writer;
  bytes(field: number, value: Bytes | undefined): Writer;
  sub(field: number, build: (writer: Writer) => void): Writer;
  finish(): Bytes;
}

/**
 * Chainable writer. Zero and empty values are skipped, matching proto3
 * semantics and what the server expects.
 */
export function writer(): Writer {
  const parts: ArrayLike<number>[] = [];
  const self: Writer = {
    raw(bytes) {
      parts.push(bytes);
      return self;
    },
    tag(field, wire) {
      return self.raw(encodeVarint(field * 8 + wire));
    },
    int(field, value) {
      if (!value) return self;
      return self.tag(field, Wire.Varint).raw(encodeVarint(value));
    },
    str(field, value) {
      if (!value) return self;
      const bytes = new TextEncoder().encode(value);
      return self.tag(field, Wire.Length).raw(encodeVarint(bytes.length)).raw(bytes);
    },
    bytes(field, value) {
      if (!value || !value.length) return self;
      return self.tag(field, Wire.Length).raw(encodeVarint(value.length)).raw(value);
    },
    sub(field, build) {
      const inner = writer();
      build(inner);
      const bytes = inner.finish();
      if (!bytes.length) return self;
      return self.tag(field, Wire.Length).raw(encodeVarint(bytes.length)).raw(bytes);
    },
    finish() {
      let length = 0;
      for (const part of parts) length += part.length;
      const out = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        out.set(part as ArrayLike<number> & Iterable<number>, offset);
        offset += part.length;
      }
      return out;
    },
  };
  return self;
}

/** Decode one message. Unknown fields come along rather than being dropped. */
export function decode(buf: Bytes): PbMessage {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: PbMessage = {};
  let p = 0;

  const readVarint = (): bigint => {
    let shift = 0n;
    let result = 0n;
    for (;;) {
      const byte = buf[p++];
      if (byte === undefined) throw new Error('Truncated protobuf varint');
      result |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return result;
      shift += 7n;
    }
  };

  while (p < buf.length) {
    const key = Number(readVarint());
    const field = key >> 3;
    const wire = key & 7;
    let value: PbValue;

    switch (wire) {
      case Wire.Varint:
        value = readVarint();
        break;
      case Wire.Fixed64:
        value = view.getFloat64(p, true);
        p += 8;
        break;
      case Wire.Length: {
        const length = Number(readVarint());
        value = buf.subarray(p, p + length);
        p += length;
        break;
      }
      case Wire.Fixed32:
        value = view.getFloat32(p, true);
        p += 4;
        break;
      default:
        throw new Error(`Unsupported protobuf wire type ${wire} at byte ${p}`);
    }
    (out[field] ??= []).push(value);
  }
  return out;
}

// -------------------------------------------------------------- navigation

export function one(msg: PbMessage | null, field: number): PbValue | undefined {
  return msg?.[field]?.[0];
}

export function all(msg: PbMessage | null, field: number): PbValue[] {
  return msg?.[field] ?? [];
}

export function bytes(msg: PbMessage | null, field: number): Bytes | null {
  const value = one(msg, field);
  return value instanceof Uint8Array ? (value as Bytes) : null;
}

export function sub(msg: PbMessage | null, field: number): PbMessage | null {
  const value = bytes(msg, field);
  return value ? decode(value) : null;
}

export function subs(msg: PbMessage | null, field: number): PbMessage[] {
  return all(msg, field)
    .filter((value): value is Bytes => value instanceof Uint8Array)
    .map(decode);
}

export function text(msg: PbMessage | null, field: number): string {
  const value = bytes(msg, field);
  return value ? new TextDecoder().decode(value) : '';
}

export function num(msg: PbMessage | null, field: number, fallback = 0): number {
  const value = one(msg, field);
  if (value === undefined || value instanceof Uint8Array) return fallback;
  return Number(value);
}
