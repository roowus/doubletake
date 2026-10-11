/**
 * OAuth plumbing for the hosted flows (ADR 0032): Google sign-in (RS256 id_token verified
 * against Google's JWKS with node:crypto — signature verification is never skipped) and the
 * OpenRouter PKCE connect. Pure helpers only: no database, no globals except `fetch` via an
 * injected callable so tests can stub it with `vi.stubGlobal`.
 */
import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUER = 'https://accounts.google.com';
export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys';

/** Structural subset of `fetch` so tests can pass a stub without a dependency on lib.dom. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export class OauthFlowError extends Error {}

/**
 * Validate an OAuth `return_to` target: relative paths only, so the flows can never redirect
 * off-site. Anything else (absolute URLs, protocol-relative, backslashes) falls back.
 */
export function safeReturnTo(raw: string | undefined | null, fallback = '/'): string {
  if (!raw) return fallback;
  if (
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    raw.includes('\r') ||
    raw.includes('\n')
  )
    return fallback;
  return raw;
}

/** S256 challenge for a PKCE verifier (RFC 7636 §4.2). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** PKCE pair per RFC 7636: 64 random bytes → an 86-char verifier and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/** b64url decode into a string. */
function b64uJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Verify an RS256 JWT against a JWKS endpoint (Google's id_token) using node:crypto:
 * signature, `aud` and `exp` are all checked — a token whose signature does not verify under a
 * published key is rejected, as is one past `exp` or issued for another client. Returns the
 * verified claims.
 */
export async function verifyRs256Jwt(
  jwt: string,
  jwksUrl: string,
  opts: { aud: string; iss?: string; fetchImpl?: FetchLike },
): Promise<Record<string, unknown>> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2])
    throw new OauthFlowError('malformed token');
  const header = b64uJson(parts[0]);
  if (header.alg !== 'RS256') throw new OauthFlowError('unsupported token algorithm');

  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(jwksUrl);
  } catch {
    throw new OauthFlowError('could not fetch signing keys');
  }
  if (!res.ok) throw new OauthFlowError('could not fetch signing keys');
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = (body.keys ?? []).filter((k) => k.kty === 'RSA' && k.n && k.e);
  const candidates = header.kid ? keys.filter((k) => k.kid === header.kid) : keys;
  if (candidates.length === 0) throw new OauthFlowError('no matching signing key');

  const signed = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], 'base64url');
  for (const jwk of candidates) {
    let key: ReturnType<typeof createPublicKey>;
    try {
      key = createPublicKey({ key: jwk as never, format: 'jwk' });
    } catch {
      continue;
    }
    const ok = createVerify('RSA-SHA256').update(signed).verify(key, signature);
    if (ok) {
      const claims = b64uJson(parts[1]);
      if (claims.aud !== opts.aud) throw new OauthFlowError('token audience mismatch');
      if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now())
        throw new OauthFlowError('token expired');
      if (opts.iss && claims.iss !== opts.iss) throw new OauthFlowError('token issuer mismatch');
      return claims;
    }
  }
  throw new OauthFlowError('token signature verification failed');
}
