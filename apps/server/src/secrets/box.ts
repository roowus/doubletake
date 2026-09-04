/**
 * Secrets at rest (ADR 0018). A 32-byte random key lives in `<dataDir>/keyfile` (mode 0600,
 * created on first use); values are sealed with XChaCha20-Poly1305-equivalent AEAD — Node ships
 * `chacha20-poly1305` with a 12-byte nonce, so we use that with a fresh nonce per value.
 * Format: `v1.<nonce b64>.<ciphertext b64>.<tag b64>`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'v1';

export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  /** Loads the keyfile, creating it (0600) when missing. */
  static open(dataDir: string): SecretBox {
    const file = path.join(dataDir, 'keyfile');
    try {
      const raw = fs.readFileSync(file);
      if (raw.length !== 32) throw new Error(`${file}: expected 32 bytes, got ${raw.length}`);
      return new SecretBox(raw);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const key = crypto.randomBytes(32);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, key, { mode: 0o600, flag: 'wx' });
    return new SecretBox(key);
  }

  static fromKey(key: Buffer): SecretBox {
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
    return new SecretBox(key);
  }

  seal(plain: string): string {
    const nonce = crypto.randomBytes(12);
    const c = crypto.createCipheriv('chacha20-poly1305', this.key, nonce, { authTagLength: 16 });
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    const tag = c.getAuthTag();
    return [PREFIX, nonce.toString('base64'), ct.toString('base64'), tag.toString('base64')].join(
      '.',
    );
  }

  open(sealed: string): string {
    const [v, n, c, t] = sealed.split('.');
    if (v !== PREFIX || !n || !c || !t) throw new Error('SecretBox: malformed value');
    const d = crypto.createDecipheriv('chacha20-poly1305', this.key, Buffer.from(n, 'base64'), {
      authTagLength: 16,
    });
    d.setAuthTag(Buffer.from(t, 'base64'));
    return Buffer.concat([d.update(Buffer.from(c, 'base64')), d.final()]).toString('utf8');
  }
}
