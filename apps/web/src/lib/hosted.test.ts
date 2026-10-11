import { describe, expect, it } from 'vitest';
import { detectHosted, failureCopy, HOSTED_OFF, hostedGate, parseAuthHash } from './hosted';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('detectHosted', () => {
  it('reports hosted mode and the invite flag from /api/status', async () => {
    const s = await detectHosted(() => json({ hosted: true, inviteRequired: true }));
    expect(s).toEqual({ hosted: true, inviteRequired: true });
  });
  it('stays self-hosted when the server says nothing about hosting', async () => {
    const s = await detectHosted(() => json({ hosted: false, brain: 'x' }));
    expect(s).toEqual(HOSTED_OFF);
  });
  it('falls back to self-hosted on a 401 (self-hosted server demands a token)', async () => {
    const s = await detectHosted(() => Promise.resolve(new Response('', { status: 401 })));
    expect(s).toEqual(HOSTED_OFF);
  });
  it('never throws when the server cannot be reached at all', async () => {
    const s = await detectHosted(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(s).toEqual(HOSTED_OFF);
  });
});

describe('parseAuthHash', () => {
  it('captures the OAuth bearer token', () => {
    expect(parseAuthHash('#dth_token=abc.123')).toEqual({
      token: 'abc.123',
      rest: '',
    });
  });
  it('captures an OAuth error message', () => {
    expect(parseAuthHash('#error=invite+required')).toEqual({
      error: 'invite required',
      rest: '',
    });
  });
  it('handles a url-encoded token and keeps unrelated fragments', () => {
    const h = parseAuthHash('#dth_token=a%2Fb&keep=1');
    expect(h.token).toBe('a/b');
    expect(h.rest).toBe('keep=1');
  });
  it('returns empty for an ordinary hash or none', () => {
    expect(parseAuthHash('')).toEqual({ rest: '' });
    expect(parseAuthHash('#section')).toEqual({ rest: 'section' });
  });
});

describe('hostedGate', () => {
  const hosted = { hosted: true, inviteRequired: false };
  it('behaves as self-hosted while detection is pending or negative', () => {
    expect(hostedGate(null, false, '/')).toBe('shell');
    expect(hostedGate(HOSTED_OFF, false, '/')).toBe('shell');
  });
  it('sends every anonymous view to login in hosted mode', () => {
    expect(hostedGate(hosted, false, '/')).toBe('login');
    expect(hostedGate(hosted, false, '/chat/x')).toBe('login');
    expect(hostedGate(hosted, false, '/login')).toBe('login');
  });
  it('keeps an authenticated session out of the login page', () => {
    expect(hostedGate(hosted, true, '/login')).toBe('leave-login');
    expect(hostedGate(hosted, true, '/library')).toBe('shell');
  });
});

describe('failureCopy', () => {
  it('maps each hosted run-failure reason to fix-it copy', () => {
    expect(failureCopy('no_credential')).toBe('Connect a brain in Account.');
    expect(failureCopy('cap_reached')).toBe('Monthly cap reached — raise it in Account.');
    expect(failureCopy('per_run_cap')).toBe('This run hit its per-run cap.');
  });
  it('rewrites the reason inside a longer error line', () => {
    expect(failureCopy('run failed: no_credential')).toBe(
      'run failed: Connect a brain in Account.',
    );
  });
  it('passes self-hosted errors through untouched', () => {
    expect(failureCopy('Daily spend cap reached.')).toBe('Daily spend cap reached.');
    expect(failureCopy('')).toBe('');
  });
});
