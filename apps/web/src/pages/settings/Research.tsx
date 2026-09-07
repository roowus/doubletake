import { useEffect, useState } from 'react';
import { api, type Status } from '../../api';
import { Icon } from '../../components/Icon';
import { MODES } from '../../components/ModeControl';
import { errText, Group, Note, Row, SettingsPage } from './parts';

/** Settings → Brains and spend: adapter health, today's spend against the cap, the modes. */
export function ResearchSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = (health: 'cached' | 'refresh') => {
    if (health === 'refresh') setChecking(true);
    api
      .status(health)
      .then(setStatus)
      .catch((e) => setMsg(errText(e)))
      .finally(() => setChecking(false));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => load('cached'), []);

  const pct = status ? Math.min(100, (status.spentTodayUsd / status.dailyCapUsd) * 100) : 0;

  return (
    <SettingsPage title="Brains and spend">
      <Group
        title="Today"
        foot="Runs park when the cap is reached and resume tomorrow. The cap and the adapters are set on the server (see docs/DEPLOYMENT.md)."
      >
        <div className="stat-row">
          <div className="stat-big">
            <span className="mono">${status ? status.spentTodayUsd.toFixed(3) : '—'}</span>
            <span className="muted small">
              of ${status ? status.dailyCapUsd.toFixed(2) : '—'} daily cap
            </span>
          </div>
          <div
            className="meter"
            aria-hidden="true"
            data-pct={Math.round(pct / 5) * 5}
            data-hot={pct >= 90 || undefined}
          >
            <span className="fill" />
          </div>
        </div>
      </Group>

      <Group
        title="Brains"
        foot={
          <>
            The default brain classifies, extracts and answers unbound modes; a mode bound with{' '}
            <code>DOUBLETAKE_BRAIN_&lt;MODE&gt;</code> goes to that adapter instead.
          </>
        }
      >
        {!status && (
          <div className="srow muted" aria-busy="true">
            Loading…
          </div>
        )}
        {status?.brains.map((b) => (
          <Row
            key={b.id}
            label={
              <>
                {b.id}
                {b.default && <span className="muted"> · default</span>}
              </>
            }
            hint={[...b.modes, b.detail].filter(Boolean).join(' · ') || 'no modes bound'}
            status={b.ok ? 'ok' : 'err'}
            value={b.ok ? 'Healthy' : 'Unhealthy'}
          />
        ))}
        {status && status.brains.length === 0 && (
          <div className="srow muted">No brain reported. Check the server log.</div>
        )}
        <Row
          icon="refresh"
          label={checking ? 'Checking…' : 'Re-check brains'}
          hint="Runs each adapter's health probe now"
          onClick={() => !checking && load('refresh')}
        />
      </Group>

      <Group title="Modes" foot="Auto picks one of these from your note.">
        {MODES.filter((m) => m.id !== 'auto').map((m) => (
          <Row key={m.id} label={m.label} hint={m.hint} value={m.time} />
        ))}
      </Group>

      {status && (
        <Group title="Notes">
          <Row
            icon="file-text"
            label="Markdown notes"
            hint="Every answer is also written here"
            value={<span className="mono small">{status.notesDir}</span>}
          />
        </Group>
      )}
      <Note error>{msg}</Note>
      {status && (
        <p className="help">
          <Icon name="info" size={14} /> Health was last checked{' '}
          {status.brains[0] ? new Date(status.brains[0].checkedAt).toLocaleTimeString() : 'never'}.
        </p>
      )}
    </SettingsPage>
  );
}
