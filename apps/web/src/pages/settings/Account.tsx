import { useEffect, useState } from 'react';
import {
  type AccountInfo,
  type AccountSession,
  api,
  type CredentialRow,
} from '../../api';
import { Confirm } from '../../components/Confirm';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { seen } from '../../format';
import { errText, Group, Note, Row, SettingsPage } from './parts';

const PROVIDERS = ['anthropic', 'openai', 'deepseek', 'gemini', 'other'] as const;

/** One hosted credential as a field-notebook card; revoked ones stay visible but dimmed. */
export function CredentialCards({
  credentials,
  onRevoke,
}: {
  credentials: CredentialRow[];
  onRevoke: (c: CredentialRow) => void;
}) {
  if (credentials.length === 0)
    return <div className="srow muted">No brains connected yet.</div>;
  return (
    <>
      {credentials.map((c) => {
        const revoked = c.revokedAt !== null;
        return (
          <div className={`srow${revoked ? ' muted' : ''}`} key={c.id}>
            <Icon name="key" className="srow-icon" />
            <span className="srow-text">
              <span className="srow-label truncate">
                {c.label || c.provider || c.kind}
                {revoked ? ' · revoked' : ''}
              </span>
              <span className="srow-hint">
                {c.kind}
                {c.provider ? ` · ${c.provider}` : ''}
                {c.monthlyCapUsd != null ? ` · $${c.monthlyCapUsd}/mo` : ''}
                {c.perRunCapUsd != null ? ` · $${c.perRunCapUsd}/run` : ''}
                {c.lastUsedAt ? ` · used ${seen(c.lastUsedAt)}` : ''}
              </span>
            </span>
            {!revoked && (
              <button
                type="button"
                className="ghost small danger"
                onClick={() => onRevoke(c)}
                aria-label={`Revoke ${c.label || c.provider || c.kind}`}
              >
                Revoke
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

function SessionRows({
  sessions,
  onRevoke,
}: {
  sessions: AccountSession[];
  onRevoke: (s: AccountSession) => void;
}) {
  const live = sessions.filter((s) => s.revokedAt === null);
  if (live.length === 0) return <div className="srow muted">No active sessions.</div>;
  return (
    <>
      {live.map((s) => (
        <div className="srow" key={s.id}>
          <Icon
            name={s.kind === 'mcp' ? 'server' : s.kind === 'device' ? 'smartphone' : 'monitor'}
            className="srow-icon"
          />
          <span className="srow-text">
            <span className="srow-label truncate">{s.label || s.kind}</span>
            <span className="srow-hint">
              {s.kind} · created {seen(s.createdAt)}
              {s.lastUsedAt ? ` · used ${seen(s.lastUsedAt)}` : ''}
            </span>
          </span>
          <button
            type="button"
            className="ghost small danger"
            onClick={() => onRevoke(s)}
            aria-label={`Revoke session ${s.label || s.kind}`}
          >
            Revoke
          </button>
        </div>
      ))}
    </>
  );
}

/** Claude Code / Truss config snippets for a fresh agent token (shown once). */
function McpSnippets({ token }: { token: string }) {
  const host = window.location.origin;
  const claude = `claude mcp add --transport http doubletake ${host}/mcp --header "Authorization: Bearer ${token}"`;
  return (
    <div className="token-block">
      <pre className="mono">{token}</pre>
      <button
        type="button"
        className="ghost small"
        onClick={() => {
          void navigator.clipboard?.writeText(token);
          toast('Token copied', 'It is shown only this once.');
        }}
      >
        Copy token
      </button>
      <p className="help">Claude Code:</p>
      <pre className="mono wrap">{claude}</pre>
      <button
        type="button"
        className="ghost small"
        onClick={() => {
          void navigator.clipboard?.writeText(claude);
          toast('Snippet copied');
        }}
      >
        Copy Claude Code command
      </button>
      <p className="help">Truss (or any MCP client) — server URL and header:</p>
      <pre className="mono wrap">{`${host}/mcp`}</pre>
      <pre className="mono wrap">{`Authorization: Bearer ${token}`}</pre>
    </div>
  );
}

/** Settings → Account (hosted only, ADR 0032): brains, caps, sessions, agent tokens, spend. */
export function AccountSettings() {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('anthropic');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [monthlyCap, setMonthlyCap] = useState('');
  const [perRunCap, setPerRunCap] = useState('');
  const [mcpLabel, setMcpLabel] = useState('');
  const [mcpToken, setMcpToken] = useState<{ token: string; label: string } | null>(null);
  const [revokeCred, setRevokeCred] = useState<CredentialRow | null>(null);
  const [revokeSess, setRevokeSess] = useState<AccountSession | null>(null);

  const load = () =>
    api
      .account()
      .then(setInfo)
      .catch((e) => setMsg(errText(e)));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.addCredential({
        kind: 'api_key',
        ...(provider !== 'other' ? { provider } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
        key,
        ...(monthlyCap.trim() ? { monthly_cap_usd: Number(monthlyCap) } : {}),
        ...(perRunCap.trim() ? { per_run_cap_usd: Number(perRunCap) } : {}),
      });
      setKey('');
      setLabel('');
      setMonthlyCap('');
      setPerRunCap('');
      toast('Key stored', 'Encrypted at rest; revoke any time.');
      load();
    } catch (ex) {
      setMsg(errText(ex));
    }
  }

  return (
    <SettingsPage
      title="Account"
      intro="Your hosted account: the brains your runs may use, what they may cost, and what can sign in as you."
    >
      <Group title="Profile" foot={info ? `Spend this month: $${info.spend.month_usd.toFixed(2)}` : undefined}>
        <Row icon="user" label={info?.user.email ?? '…'} hint="Signed in with this e-mail" />
        <Row
          icon="external-link"
          label="Connect OpenRouter"
          hint="One OAuth connect instead of pasting keys; revocable from OpenRouter or here"
          onClick={() => {
            window.location.href = '/api/auth/openrouter';
          }}
        />
      </Group>

      <Group
        title="Paste a key"
        foot="Keys are encrypted at rest and used only to run your requests. The OpenRouter connect is the revocable alternative."
      >
        <form className="stack" onSubmit={addKey}>
          <div className="field">
            <label htmlFor="a-provider">Provider</label>
            <select
              id="a-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as (typeof PROVIDERS)[number])}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-key">API key</label>
            <input
              id="a-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="a-label">Label</label>
            <input
              id="a-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. personal anthropic"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="a-monthly">Monthly cap $</label>
              <input
                id="a-monthly"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={monthlyCap}
                onChange={(e) => setMonthlyCap(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="a-perrun">Per-run cap $</label>
              <input
                id="a-perrun"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={perRunCap}
                onChange={(e) => setPerRunCap(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="primary" disabled={!key.trim()}>
            Store key
          </button>
        </form>
      </Group>

      <Group title="Connected brains">
        <CredentialCards
          credentials={info?.credentials ?? []}
          onRevoke={setRevokeCred}
        />
      </Group>

      <Group
        title="Sessions"
        foot="Browsers, paired devices and MCP clients signed in as you. Revoke stops the token at once."
      >
        <SessionRows sessions={info?.sessions ?? []} onRevoke={setRevokeSess} />
      </Group>

      <Group title="Agent tokens (MCP)">
        <div className="field">
          <label htmlFor="a-mcp-label">Token label</label>
          <input
            id="a-mcp-label"
            value={mcpLabel}
            onChange={(e) => setMcpLabel(e.target.value)}
            placeholder="e.g. laptop claude code"
          />
        </div>
        <button
          type="button"
          className="primary"
          disabled={!mcpLabel.trim()}
          onClick={() => {
            api
              .createMcpToken(mcpLabel.trim())
              .then((t) => {
                setMcpToken({ token: t.token, label: t.label });
                setMcpLabel('');
              })
              .catch((e) => setMsg(errText(e)));
          }}
        >
          Create agent token
        </button>
        {mcpToken && (
          <>
            <p className="help">Copy it now — {mcpToken.label} is shown only this once.</p>
            <McpSnippets token={mcpToken.token} />
          </>
        )}
      </Group>
      <Note error>{msg}</Note>

      <Confirm
        open={revokeCred !== null}
        onOpenChange={(o) => !o && setRevokeCred(null)}
        title={`Revoke ${revokeCred?.label || revokeCred?.provider || 'credential'}?`}
        body="Revoking wipes the stored key. Runs that needed it fail until you connect another brain."
        action="Revoke"
        onConfirm={() =>
          revokeCred
            ? api
                .revokeCredential(revokeCred.id)
                .then(() => {
                  toast('Credential revoked');
                  load();
                })
                .catch((e) => setMsg(errText(e)))
            : undefined
        }
      />
      <Confirm
        open={revokeSess !== null}
        onOpenChange={(o) => !o && setRevokeSess(null)}
        title={`Revoke ${revokeSess?.label || revokeSess?.kind || 'session'}?`}
        body="Its token stops working right away."
        action="Revoke"
        onConfirm={() =>
          revokeSess
            ? api
                .revokeAccountSession(revokeSess.id)
                .then(() => {
                  toast('Session revoked');
                  load();
                })
                .catch((e) => setMsg(errText(e)))
            : undefined
        }
      />
    </SettingsPage>
  );
}
