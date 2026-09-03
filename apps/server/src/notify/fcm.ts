import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Notification, Notifier, PushTarget, SendOutcome } from './types.js';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function loadServiceAccount(file: string): ServiceAccount {
  const sa = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ServiceAccount>;
  if (!sa.project_id || !sa.client_email || !sa.private_key)
    throw new Error(`${file} is not a Firebase service-account JSON`);
  return sa as ServiceAccount;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Firebase Cloud Messaging over the HTTP v1 API, authenticated with a service-account JWT.
 * Implemented directly (no google-auth-library) to keep the dependency surface small; the
 * token exchange is two requests and is cached until a minute before expiry.
 */
export class FcmNotifier implements Notifier {
  readonly kind = 'fcm' as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly sa: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async accessToken(): Promise<string> {
    const t = this.now();
    if (this.token && this.token.expiresAt - 60_000 > t) return this.token.value;
    const iat = Math.floor(t / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({
        iss: this.sa.client_email,
        scope: SCOPE,
        aud: this.sa.token_uri ?? 'https://oauth2.googleapis.com/token',
        iat,
        exp: iat + 3600,
      }),
    );
    const signature = crypto.sign(
      'RSA-SHA256',
      Buffer.from(`${header}.${claims}`),
      this.sa.private_key,
    );
    const assertion = `${header}.${claims}.${b64url(signature)}`;
    const res = await this.fetchImpl(this.sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`FCM token exchange failed: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: t + json.expires_in * 1000 };
    return json.access_token;
  }

  async send(target: PushTarget, n: Notification): Promise<SendOutcome> {
    try {
      const token = await this.accessToken();
      const res = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: target.endpoint,
              // A `notification` block (not data-only) so Android shows it when the app is killed.
              notification: { title: n.title, body: n.body },
              data: { chatId: n.chatId, url: n.url },
              android: {
                priority: 'high',
                collapse_key: n.tag,
                notification: { tag: n.tag, channel_id: 'doubletake' },
              },
            },
          }),
        },
      );
      if (res.ok) return { status: 'ok' };
      const text = await res.text();
      // 404 UNREGISTERED / 400 INVALID_ARGUMENT on the token: the device token is dead.
      if (
        res.status === 404 ||
        (res.status === 400 && /UNREGISTERED|not a valid FCM registration token/i.test(text))
      )
        return { status: 'gone' };
      return { status: 'failed', error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message };
    }
  }
}
