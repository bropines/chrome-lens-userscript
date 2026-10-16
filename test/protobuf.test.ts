import { describe, expect, test } from 'bun:test';
import {
  Wire,
  all,
  bytes,
  decode,
  encodeVarint,
  num,
  one,
  sub,
  subs,
  text,
  writer,
} from '../src/protobuf.js';
import type { Bytes } from '../src/types.js';

const bytesOf = (...values: number[]): Bytes => Uint8Array.from(values) as Bytes;

describe('encodeVarint', () => {
  test('small values are one byte, larger ones carry on', () => {
    expect(encodeVarint(0)).toEqual([0]);
    expect(encodeVarint(127)).toEqual([127]);
    expect(encodeVarint(128)).toEqual([0x80, 0x01]);
    expect(encodeVarint(300)).toEqual([0xac, 0x02]);
  });

  test('a negative number is sign-extended to ten bytes, as the spec says', () => {
    // This looped forever: -1n >> 7n is -1n, which is never under 128.
    expect(encodeVarint(-1)).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    expect(encodeVarint(-2)).toEqual([0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    expect(encodeVarint(-1n)).toEqual(encodeVarint(-1));
  });

  test('the largest 64-bit value survives as a bigint', () => {
    expect(encodeVarint(2n ** 64n - 1n)).toEqual(encodeVarint(-1));
  });

  test('refuses what has no integer encoding rather than throwing a vaguer error', () => {
    expect(() => encodeVarint(1.5)).toThrow(/not an integer/);
  });
});

describe('writer and decode', () => {
  test('round-trips every kind of field', () => {
    const message = writer()
      .int(1, 150)
      .str(2, 'héllo мир \u{1F600}')
      .bytes(3, bytesOf(0, 255, 7))
      .sub(4, (inner) => inner.int(1, 9).str(2, 'nested'))
      .finish();

    const decoded = decode(message);
    expect(num(decoded, 1)).toBe(150);
    expect(text(decoded, 2)).toBe('héllo мир \u{1F600}');
    expect(Array.from(bytes(decoded, 3) ?? [])).toEqual([0, 255, 7]);
    const inner = sub(decoded, 4);
    expect(num(inner, 1)).toBe(9);
    expect(text(inner, 2)).toBe('nested');
  });

  test('a negative varint comes back as its unsigned 64-bit pattern', () => {
    for (const value of [-1, -2, -128, -2147483648, -9007199254740991]) {
      const decoded = decode(writer().int(1, value).finish());
      const raw = one(decoded, 1);
      expect(typeof raw).toBe('bigint');
      expect(BigInt.asIntN(64, raw as bigint)).toBe(BigInt(value));
    }
  });

  test('zero and empty values are left out, as proto3 does', () => {
    const message = writer().int(1, 0).str(2, '').bytes(3, bytesOf()).sub(4, () => {}).finish();
    expect(message.length).toBe(0);
  });

  test('a repeated field keeps every occurrence in order', () => {
    const message = writer().int(1, 1).int(1, 2).int(1, 3).finish();
    expect(all(decode(message), 1)).toEqual([1n, 2n, 3n]);
  });

  test('subs reads each repeated message', () => {
    const message = writer()
      .sub(1, (inner) => inner.str(1, 'a'))
      .sub(1, (inner) => inner.str(1, 'b'))
      .finish();
    expect(subs(decode(message), 1).map((item) => text(item, 1))).toEqual(['a', 'b']);
  });

  test('fixed32 reads as a float, fixed64 as a double', () => {
    const f32 = new DataView(new ArrayBuffer(4));
    f32.setFloat32(0, 0.25, true);
    const f64 = new DataView(new ArrayBuffer(8));
    f64.setFloat64(0, -1.5, true);
    const message = writer()
      .tag(1, Wire.Fixed32)
      .raw(new Uint8Array(f32.buffer))
      .tag(2, Wire.Fixed64)
      .raw(new Uint8Array(f64.buffer))
      .finish();
    const decoded = decode(message);
    expect(num(decoded, 1)).toBe(0.25);
    expect(num(decoded, 2)).toBe(-1.5);
  });

  test('a missing field is the fallback, not an error', () => {
    const decoded = decode(writer().int(1, 5).finish());
    expect(num(decoded, 9, 42)).toBe(42);
    expect(text(decoded, 9)).toBe('');
    expect(sub(decoded, 9)).toBeNull();
    expect(bytes(null, 1)).toBeNull();
  });

  test('a decoded field is a view onto the input, not a copy', () => {
    const message = writer().bytes(1, bytesOf(1, 2, 3)).finish();
    const field = bytes(decode(message), 1);
    expect(field?.buffer).toBe(message.buffer);
  });
});

describe('malformed input is an error that says why', () => {
  test('a varint cut off mid-way', () => {
    expect(() => decode(bytesOf(0x08, 0x80))).toThrow(/Truncated protobuf varint/);
  });

  test('a varint that never ends', () => {
    const endless = bytesOf(0x08, ...new Array(11).fill(0xff));
    expect(() => decode(endless)).toThrow(/Malformed protobuf varint/);
  });

  test('a length longer than what is left', () => {
    // Field 1, length 5, three bytes of payload. subarray() would clamp this
    // to a three-byte field that decodes as something else entirely.
    expect(() => decode(bytesOf(0x0a, 0x05, 1, 2, 3))).toThrow(/Truncated protobuf length-delimited/);
  });

  test('a length that is absurd', () => {
    const huge = Uint8Array.from([0x0a, ...encodeVarint(2n ** 40n)]) as Bytes;
    expect(() => decode(huge)).toThrow(/Truncated protobuf length-delimited/);
  });

  test('a length with no payload at all', () => {
    expect(() => decode(bytesOf(0x0a, 0x01))).toThrow(/Truncated/);
  });

  test('fixed-width fields cut short', () => {
    expect(() => decode(bytesOf(0x0d, 1, 2, 3))).toThrow(/Truncated protobuf fixed32/);
    expect(() => decode(bytesOf(0x09, 1, 2, 3, 4, 5, 6, 7))).toThrow(/Truncated protobuf fixed64/);
  });

  test('a wire type this codec does not speak', () => {
    // Wire type 3 is the long-deprecated start-group.
    expect(() => decode(bytesOf(0x0b))).toThrow(/Unsupported protobuf wire type 3/);
  });

  test('an empty buffer is an empty message', () => {
    expect(decode(bytesOf())).toEqual({});
  });
});
