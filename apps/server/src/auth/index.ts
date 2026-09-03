import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { Repo } from '../db/repo.js';

const OWNER_KEY = 'owner_password_hash';
const PAIRING_TTL_MS = 10 * 60_000;

export interface Session {
  deviceId: string;
  deviceName: string;
}

/**
 * Auth model (ADR 0010): one owner password set at first boot; every client holds a long-lived
 * device token. Tokens are random, stored hashed (sha256; they are already high-entropy), sent as
 * `Authorization: Bearer <token>`. Pairing: an authenticated device (or the owner password) mints a
 * short-lived code, the new device exchanges it for its own token.
 */
export class Auth {
  private pairings = new Map<string, { expires: number; name?: string }>();

  constructor(private readonly repo: Repo) {}

  hasOwner(): boolean {
    return Boolean(this.repo.getSetting(OWNER_KEY));
  }

  async setOwnerPassword(password: string): Promise<void> {
    if (password.length < 8) throw new AuthError('password must be at least 8 characters');
    this.repo.setSetting(OWNER_KEY, await argonHash(password));
  }

  async verifyOwnerPassword(password: string): Promise<boolean> {
    const h = this.repo.getSetting(OWNER_KEY);
    if (!h) return false;
    try {
      return await argonVerify(h, password);
    } catch {
      return false;
    }
  }

  /** Issue a device token. The raw token is returned once and never stored. */
  createDevice(name: string, platform: string): { token: string; deviceId: string } {
    const token = `dt_${randomBytes(32).toString('base64url')}`;
    const device = this.repo.createDevice(name, platform, hashToken(token));
    return { token, deviceId: device.id };
  }

  authenticate(bearer: string | undefined): Session | null {
    if (!bearer?.startsWith('dt_')) return null;
    const device = this.repo.findDeviceByTokenHash(hashToken(bearer));
    if (!device || device.revokedAt) return null;
    this.repo.touchDevice(device.id);
    return { deviceId: device.id, deviceName: device.name };
  }

  /** 6-digit-ish pairing code; single use; 10 min TTL. */
  createPairingCode(): { code: string; expiresAt: string } {
    this.sweep();
    const code = randomBytes(4)
      .readUInt32BE(0)
      .toString(36)
      .toUpperCase()
      .padStart(7, '0')
      .slice(-6);
    const expires = Date.now() + PAIRING_TTL_MS;
    this.pairings.set(code, { expires });
    return { code, expiresAt: new Date(expires).toISOString() };
  }

  redeemPairingCode(code: string, name: string, platform: string) {
    this.sweep();
    const norm = code.trim().toUpperCase();
    for (const [k, v] of this.pairings) {
      if (k.length === norm.length && timingSafeEqual(Buffer.from(k), Buffer.from(norm))) {
        this.pairings.delete(k);
        if (v.expires < Date.now()) throw new AuthError('pairing code expired');
        return this.createDevice(name, platform);
      }
    }
    throw new AuthError('invalid pairing code');
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pairings) if (v.expires < now) this.pairings.delete(k);
  }
}

export class AuthError extends Error {}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
