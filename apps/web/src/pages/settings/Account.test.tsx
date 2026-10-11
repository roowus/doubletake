// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CredentialRow } from '../../api';
import { CredentialCards } from './Account';

const cred = (over: Partial<CredentialRow>): CredentialRow => ({
  id: 'cr1',
  kind: 'api_key',
  provider: 'anthropic',
  label: 'personal key',
  baseUrl: null,
  monthlyCapUsd: 20,
  perRunCapUsd: 0.5,
  lastUsedAt: '2026-10-10T09:00:00Z',
  revokedAt: null,
  createdAt: '2026-10-01T09:00:00Z',
  ...over,
});

describe('CredentialCards', () => {
  it('renders the API credential shape with provider, caps and last use', () => {
    const html = renderToStaticMarkup(
      <CredentialCards credentials={[cred({})]} onRevoke={() => {}} />,
    );
    expect(html).toContain('personal key');
    expect(html).toContain('api_key · anthropic');
    expect(html).toContain('$20/mo');
    expect(html).toContain('$0.5/run');
    expect(html).toContain('Revoke personal key');
  });

  it('renders an OpenRouter credential and an empty state', () => {
    const html = renderToStaticMarkup(
      <CredentialCards
        credentials={[cred({ id: 'cr2', kind: 'openrouter', provider: null, label: null })]}
        onRevoke={() => {}}
      />,
    );
    expect(html).toContain('openrouter');
    expect(
      renderToStaticMarkup(<CredentialCards credentials={[]} onRevoke={() => {}} />),
    ).toContain('No brains connected yet');
  });

  it('dims revoked credentials and hides their revoke action', () => {
    const html = renderToStaticMarkup(
      <CredentialCards
        credentials={[cred({ revokedAt: '2026-10-11T00:00:00Z' })]}
        onRevoke={() => {}}
      />,
    );
    expect(html).toContain('revoked');
    expect(html).not.toContain('Revoke personal key');
  });
});
