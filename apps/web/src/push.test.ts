// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { b64ToBytes, bytesToB64 } from './push';

describe('push key encoding', () => {
  it('decodes a base64url VAPID key into raw bytes and round-trips', () => {
    // 65-byte uncompressed P-256 point, as web-push emits it (base64url, no padding).
    const raw = new Uint8Array(65).map((_, i) => (i * 7 + 3) & 0xff);
    raw[0] = 0x04;
    const b64url = Buffer.from(raw).toString('base64url');
    const bytes = b64ToBytes(b64url);
    expect(bytes.length).toBe(65);
    expect(Array.from(bytes)).toEqual(Array.from(raw));
    expect(bytesToB64(bytes.buffer)).toBe(Buffer.from(raw).toString('base64'));
  });

  it('tolerates padded standard base64 too', () => {
    const b64 = Buffer.from('hello').toString('base64');
    expect(new TextDecoder().decode(b64ToBytes(b64))).toBe('hello');
  });
});
