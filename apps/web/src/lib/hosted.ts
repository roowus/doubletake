import { useSyncExternalStore } from 'react';
import { apiBase } from '../native';

/**
 * Hosted mode (ADR 0032): the PWA can be served by the hosted backend, where accounts sign in
 * with e-mail + password (or Google) instead of pairing against an owner password. Detected
 * once at boot from `GET /api/status`; while the answer is pending (or the server never says
 * so) the app behaves exactly as the self-hosted PWA always has.
 */
export interface HostedStatus {
  hosted: boolean;
  inviteRequired: boolean;
}

/** The pre-detection snapshot: all hosted UI stays hidden until the server says otherwise. */
export const HOSTED_OFF: HostedStatus = { hosted: false, inviteRequired: false };

let current: HostedStatus | null = null;
const subscribers = new Set<() => void>();

function publish(next: HostedStatus): void {
  current = next;
  for (const s of subscribers) s();
}

export function hostedSnapshot(): HostedStatus | null {
  return current;
}

export function subscribeHosted(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** `null` while the boot-time probe is in flight. */
export function useHosted(): HostedStatus | null {
  return useSyncExternalStore(subscribeHosted, hostedSnapshot, hostedSnapshot);
}

/** True once detection has finished and the server reported hosted mode. */
export function isHostedSnapshot(): boolean {
  return current?.hosted === true;
}

/**
 * The boot-time probe. Deliberately a bare fetch without a bearer: it runs before any session
 * exists, and a self-hosted server answers 401 (or the request fails offline) — in every such
 * case we stay in self-hosted behaviour. Never throws.
 */
export async function detectHosted(fetchImpl: typeof fetch = fetch): Promise<HostedStatus> {
  try {
    const res = await fetchImpl(`${apiBase()}/api/status`, { method: 'GET' });
    if (!res.ok) return HOSTED_OFF;
    const j = (await res.json()) as { hosted?: unknown; inviteRequired?: unknown };
    return {
      hosted: j.hosted === true,
      inviteRequired: j.inviteRequired === true,
    };
  } catch {
    return HOSTED_OFF;
  }
}

/** Run once at boot; publishes the result to `useHosted` subscribers. */
export async function detectHostedOnce(): Promise<HostedStatus> {
  const s = await detectHosted();
  publish(s);
  return s;
}

// ---- OAuth return handling ----

export interface AuthHash {
  /** Bearer token from the Google callback (`#dth_token=…`). */
  token?: string | undefined;
  /** Human-readable failure from the callback (`#error=…`). */
  error?: string | undefined;
  /** The hash with those two keys removed (other fragments are preserved). */
  rest: string;
}

/** Parse `#dth_token=<bearer>` / `#error=<msg>` out of `location.hash`. */
export function parseAuthHash(hash: string): AuthHash {
  const raw = hash.replace(/^#/, '');
  if (!raw) return { rest: '' };
  const kept: string[] = [];
  const out: AuthHash = { rest: '' };
  for (const part of raw.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? '' : part.slice(eq + 1);
    if (key === 'dth_token' && value) out.token = decodeURIComponent(value);
    else if (key === 'error' && value) out.error = decodeURIComponent(value.replace(/\+/g, ' '));
    else kept.push(part);
  }
  out.rest = kept.join('&');
  return out;
}

// ---- Route gating ----

export type Gate = 'shell' | 'login' | 'leave-login';

/**
 * Pure hosted-mode route gate. `hosted === null` means detection is still pending: behave as
 * self-hosted (no hosted UI). Anonymous in hosted mode every view lands on login; an
 * authenticated session never sees the login page again.
 */
export function hostedGate(hosted: HostedStatus | null, authed: boolean, path: string): Gate {
  if (!hosted?.hosted) return 'shell';
  if (!authed) return path === '/login' ? 'login' : 'login';
  return path === '/login' ? 'leave-login' : 'shell';
}

// ---- Hosted run-failure copy ----

const REASONS: Record<string, string> = {
  no_credential: 'Connect a brain in Account.',
  cap_reached: 'Monthly cap reached — raise it in Account.',
  per_run_cap: 'This run hit its per-run cap.',
};

/**
 * Map a run-failure reason (ADR 0032: `no_credential` | `cap_reached` | `per_run_cap`) to
 * owner-readable copy, linking to the hosted Account page where it is fixed. Any other text —
 * including everything a self-hosted server emits — passes through untouched.
 */
export function failureCopy(text: string): string {
  const trimmed = text.trim();
  if (REASONS[trimmed]) return REASONS[trimmed];
  return text.replace(/\b(no_credential|cap_reached|per_run_cap)\b/g, (m) => REASONS[m] ?? m);
}
