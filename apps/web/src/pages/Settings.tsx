import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import {
  ApiError,
  api,
  type Device,
  getToken,
  type IgStatus,
  type QuietHours,
  type Status,
  setToken,
} from '../api';
import { Icon } from '../components/Icon';
import { seen } from '../format';
import {
  apiBase,
  disableNativePush,
  enableNativePush,
  isNative,
  nativePlatform,
  nativePushEnabled,
} from '../native';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push';
import { navigate } from '../router';

export function Settings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pair, setPair] = useState<{
    code: string;
    expiresAt: string;
    url: string;
    qr: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const native = isNative();
  // No APNs in v1 (ADR 0027): the iOS app shows the limitation instead of a toggle.
  const ios = native && nativePlatform() === 'ios';
  const [push, setPush] = useState<'unsupported' | 'off' | 'on' | 'busy'>(
    ios ? 'unsupported' : native || pushSupported() ? 'busy' : 'unsupported',
  );
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const [quietMsg, setQuietMsg] = useState<string | null>(null);
  const [ig, setIg] = useState<IgStatus | 'off' | null>(null);
  const [igMsg, setIgMsg] = useState<string | null>(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('ig') === 'connected') return 'Instagram connected.';
    if (q.get('ig') === 'error') return `Instagram: ${q.get('message') ?? 'connection failed'}`;
    return null;
  });
  const loadIg = () =>
    api
      .igStatus()
      .then(setIg)
      .catch((e) => setIg(e instanceof ApiError && e.status === 404 ? 'off' : null));

  const [checking, setChecking] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importResearch, setImportResearch] = useState<'' | 'quick' | 'standard'>('');
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setImportMsg('Importing…');
    try {
      const parsed: unknown = JSON.parse(await f.text());
      const r = await api.importKarakeep(parsed, importResearch || undefined);
      setImportMsg(
        `Imported ${r.imported}, skipped ${r.skipped} already saved or empty, ${r.collections} new collection${r.collections === 1 ? '' : 's'}${r.runs ? `, ${r.runs} research runs queued` : ''}.`,
      );
    } catch (e) {
      setImportMsg(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const download = async (kind: 'karakeep' | 'memos') => {
    setImportMsg(null);
    try {
      const res = await fetch(`${apiBase()}/api/export/${kind}`, {
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `doubletake-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setImportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const load = (health: 'cached' | 'refresh' = 'cached') => {
    if (health === 'refresh') setChecking(true);
    api
      .status(health)
      .then((st) => {
        setStatus(st);
        setQuiet((q) => q ?? st.push.quietHours);
      })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setChecking(false));
    api
      .devices()
      .then(setDevices)
      .catch(() => {});
  };
  useEffect(load, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount, like `load`
  useEffect(() => {
    loadIg();
  }, []);
  useEffect(() => {
    if (ios || (!native && !pushSupported())) return;
    (native ? nativePushEnabled() : pushEnabled())
      .then((on) => setPush(on ? 'on' : 'off'))
      .catch(() => setPush('off'));
  }, [native, ios]);

  const togglePush = async () => {
    setPushMsg(null);
    setPush('busy');
    try {
      if (push === 'on') {
        await (native ? disableNativePush() : disablePush());
        setPush('off');
      } else if (native) {
        if (!status?.push.kinds.includes('fcm'))
          throw new Error('The server has no FCM credentials (set FCM_SERVICE_ACCOUNT_PATH).');
        // Resolves only once the FCM token has been posted to the server (or throws why not).
        await enableNativePush();
        setPush('on');
        setPushMsg('Notifications enabled on this device.');
      } else {
        const key = status?.push.vapidPublicKey;
        if (!key) throw new Error('The server has no Web Push key (is webpush configured?).');
        await enablePush(key);
        setPush('on');
        setPushMsg('Notifications enabled on this device.');
      }
    } catch (e) {
      setPush(push === 'on' ? 'on' : 'off');
      setPushMsg(String((e as Error).message ?? e));
    }
  };

  return (
    <div className="page narrow settings stack loose">
      <div className="page-head">
        <button
          type="button"
          className="ghost icon"
          onClick={() => navigate('/')}
          aria-label="Back"
        >
          <Icon name="arrow-left" />
        </button>
        <h2>Settings</h2>
      </div>
      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}

      <section className="card">
        <h3>
          <Icon name="server" />
          Server
        </h3>
        {status ? (
          <>
            <div className="list">
              {status.brains.map((b) => (
                <div className="list-row" key={b.id}>
                  <Icon
                    name={b.ok ? 'check' : 'x'}
                    className={b.ok ? 'ok' : 'err'}
                    label={b.ok ? 'healthy' : 'unhealthy'}
                  />
                  <div className="body">
                    <span className="primary">
                      {b.id}
                      {b.default && <span className="muted small"> · default</span>}
                    </span>
                    <span className="secondary truncate">
                      {[...b.modes, b.detail].filter(Boolean).join(' · ') || 'no modes assigned'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="stack tight">
              {native && (
                <div className="kv-row">
                  <span>Server</span>
                  <span className="mono">{apiBase()}</span>
                </div>
              )}
              <div className="kv-row">
                <span>Spent today</span>
                <span className="mono">
                  ${status.spentTodayUsd.toFixed(3)} / ${status.dailyCapUsd.toFixed(2)} cap
                </span>
              </div>
              <div className="kv-row">
                <span>Notes exported to</span>
                <span className="mono">{status.notesDir}</span>
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="ghost"
                disabled={checking}
                onClick={() => load('refresh')}
              >
                <Icon name="refresh" />
                {checking ? 'Checking…' : 'Re-check brains'}
              </button>
            </div>
            <p className="help">
              Brain, cap and paths are configured on the server (environment / .env). See
              docs/DEPLOYMENT.md.
            </p>
          </>
        ) : (
          <div className="muted small" aria-busy="true">
            Loading…
          </div>
        )}
      </section>

      <section className="card">
        <h3>
          <Icon name="bell" />
          Notifications
        </h3>
        <p className="help">
          Get a push when an answer is ready. Requires HTTPS (Tailscale serve) and, on Android, the
          installed app or PWA. The notification carries the title only, never the answer.
        </p>
        {push === 'unsupported' ? (
          <p className="small muted">
            {ios
              ? 'The iOS app has no push yet (no APNs in v1). Set up ntfy or Telegram in .env to be notified on this phone.'
              : 'This browser does not support Web Push.'}
          </p>
        ) : (
          <div className="actions">
            <button
              type="button"
              className={push === 'on' ? 'ghost' : 'primary'}
              disabled={push === 'busy'}
              onClick={togglePush}
            >
              {push === 'on'
                ? 'Disable on this device'
                : push === 'busy'
                  ? 'Working…'
                  : 'Enable on this device'}
            </button>
            {push === 'on' && (
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  api
                    .pushTest()
                    .then((r) =>
                      setPushMsg(
                        r.sent > 0
                          ? 'Test sent.'
                          : `Nothing sent (gone ${r.gone}, failed ${r.failed}). Try disabling and enabling again.`,
                      ),
                    )
                    .catch((e) => setPushMsg(String(e.message ?? e)))
                }
              >
                Send test
              </button>
            )}
          </div>
        )}
        {pushMsg && (
          <p className="msg-inline" role="status">
            {pushMsg}
          </p>
        )}
        {status && status.push.kinds.length > 0 && (
          <div className="kv-row">
            <span>Server push</span>
            <span>{status.push.kinds.join(', ')}</span>
          </div>
        )}
        {status && status.push.channels.length > 0 && (
          <>
            <div className="kv-row">
              <span>Owner channels</span>
              <span>{status.push.channels.join(', ')}</span>
            </div>
            <div className="actions">
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  api
                    .pushChannelsTest()
                    .then((r) =>
                      setPushMsg(
                        r.failed === 0
                          ? `Sent to ${r.sent} channel${r.sent === 1 ? '' : 's'}.`
                          : `${r.failed} channel(s) failed — see the server log.`,
                      ),
                    )
                    .catch((e) => setPushMsg(String(e.message ?? e)))
                }
              >
                Send test to channels
              </button>
            </div>
          </>
        )}
        {status && quiet && (
          <div className="stack quiet-hours">
            <div className="divider" />
            <label className="check">
              <input
                type="checkbox"
                checked={quiet.enabled}
                onChange={(e) => setQuiet({ ...quiet, enabled: e.target.checked })}
              />
              <span>
                <b>Quiet hours</b>
                <span className="help">
                  {' '}
                  Hold notifications and send one digest when the window ends.
                </span>
              </span>
            </label>
            <div className="times">
              <label className="field">
                <span className="label">From</span>
                <input
                  type="time"
                  value={quiet.start}
                  onChange={(e) => setQuiet({ ...quiet, start: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">To</span>
                <input
                  type="time"
                  value={quiet.end}
                  onChange={(e) => setQuiet({ ...quiet, end: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span className="label">Time zone</span>
              <input
                className="tz"
                value={quiet.timeZone}
                onChange={(e) => setQuiet({ ...quiet, timeZone: e.target.value })}
                list="tz-list"
              />
              <datalist id="tz-list">
                {[Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC'].map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </label>
            <div className="actions">
              <button
                type="button"
                onClick={() =>
                  api
                    .setQuietHours(quiet)
                    .then((r) => {
                      setQuiet(r.quietHours);
                      setQuietMsg('Saved.');
                      load();
                    })
                    .catch((e) => setQuietMsg(String(e.message ?? e)))
                }
              >
                Save quiet hours
              </button>
              {status.push.pending > 0 && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    api
                      .flushDigest()
                      .then((r) => {
                        setQuietMsg(`Digest sent (${r.sent}).`);
                        load();
                      })
                      .catch((e) => setQuietMsg(String(e.message ?? e)))
                  }
                >
                  Send digest now ({status.push.pending})
                </button>
              )}
            </div>
            {quietMsg && (
              <p className="msg-inline" role="status">
                {quietMsg}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h3>
          <Icon name="instagram" />
          Instagram
        </h3>
        <p className="help">
          DM a reel to your shadow account, or @mention it in a comment, and the answer arrives
          here. Setup: docs/channels/instagram-setup.md.
        </p>
        {ig === null && (
          <div className="small muted" aria-busy="true">
            Loading…
          </div>
        )}
        {ig === 'off' && (
          <p className="small muted">
            Not configured on the server (set IG_APP_ID, IG_APP_SECRET and IG_WEBHOOK_VERIFY_TOKEN,
            then restart).
          </p>
        )}
        {ig && ig !== 'off' && (
          <>
            <div className="stack tight">
              <div className="kv-row">
                <span>Account</span>
                <span>{ig.connected ? `@${ig.username ?? ig.igUserId}` : 'Not connected'}</span>
              </div>
              {ig.connected && ig.expiresAt && (
                <div className="kv-row">
                  <span>Token expires</span>
                  <span>{new Date(ig.expiresAt).toLocaleDateString()}</span>
                </div>
              )}
              {ig.connected && ig.refreshedAt && (
                <div className="kv-row">
                  <span>Last refreshed</span>
                  <span>{new Date(ig.refreshedAt).toLocaleDateString()}</span>
                </div>
              )}
              <div className="kv-row">
                <span>Mention polling</span>
                <span>{ig.mentionPolling ? 'on' : 'off'}</span>
              </div>
              <div className="kv-row">
                <span>Webhook host</span>
                <span>{ig.webhookPublicHost ?? 'not set'}</span>
              </div>
            </div>
            <div className="actions">
              {ig.connected ? (
                <>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      api
                        .igPoll()
                        .then((r) =>
                          setIgMsg(
                            `Poll: ${r.handled.length} new, ${r.duplicates} seen before, ${r.ignored} ignored.`,
                          ),
                        )
                        .catch((e) => setIgMsg(String(e.message ?? e)))
                    }
                  >
                    Poll mentions now
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      api
                        .igRefresh()
                        .then((s) => {
                          setIg(s);
                          setIgMsg('Token refreshed.');
                        })
                        .catch((e) => setIgMsg(String(e.message ?? e)))
                    }
                  >
                    Refresh token
                  </button>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={() => {
                      if (!confirm('Disconnect the Instagram account?')) return;
                      api
                        .igDisconnect()
                        .then(() => {
                          setIgMsg('Disconnected.');
                          loadIg();
                        })
                        .catch((e) => setIgMsg(String(e.message ?? e)));
                    }}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    api
                      .igConnect()
                      .then((r) => {
                        location.href = r.url;
                      })
                      .catch((e) => setIgMsg(String(e.message ?? e)))
                  }
                >
                  Connect Instagram
                </button>
              )}
            </div>
            {ig.recentEvents.length > 0 && (
              <p className="small muted">
                Recent events:{' '}
                {ig.recentEvents
                  .slice(0, 5)
                  .map((e) => `${e.kind}${e.error ? ' (error)' : ''}`)
                  .join(', ')}
              </p>
            )}
          </>
        )}
        {igMsg && (
          <p className="msg-inline" role="status">
            {igMsg}
          </p>
        )}
      </section>

      <section className="card">
        <h3>
          <Icon name="smartphone" />
          Pair a device
        </h3>
        <p className="help">
          Open Doubletake on the other device, choose “Pairing code”, and scan or type this code.
          Codes expire after 10 minutes and work once.
        </p>
        {pair ? (
          <div className="stack">
            <div className="qr">
              <QRCodeSVG
                value={`${pair.url}/?code=${pair.code}`}
                size={196}
                bgColor="#ffffff"
                fgColor="#14171f"
                includeMargin
              />
            </div>
            <div className="pair-code">
              <span className="sr-only">Pairing code </span>
              {pair.code}
            </div>
            <div className="small muted mono truncate">{pair.url}</div>
          </div>
        ) : (
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() =>
                api
                  .pairStart()
                  .then(setPair)
                  .catch((e) => setErr(String(e.message ?? e)))
              }
            >
              Show pairing code
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h3>
          <Icon name="monitor" />
          Devices
        </h3>
        {devices.length === 0 ? (
          <p className="small muted">No paired devices yet.</p>
        ) : (
          <div className="list">
            {devices.map((d) => (
              <div className="list-row" key={d.id}>
                <Icon
                  name={d.platform === 'android' || d.platform === 'ios' ? 'smartphone' : 'monitor'}
                />
                <div className="body">
                  <span className="primary truncate">{d.name}</span>
                  <span className="secondary truncate">
                    {d.platform}
                    {d.lastSeenAt ? ` · ${seen(d.lastSeenAt)}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost small danger"
                  onClick={() =>
                    api.revokeDevice(d.id).then(() => {
                      load();
                    })
                  }
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="help">
          Other agents (Claude Code, Claude Desktop, …) connect the same way: redeem a pairing code
          for a token, then point their MCP client at <code>{window.location.origin}/mcp</code> with{' '}
          <code>Authorization: Bearer &lt;token&gt;</code>. They appear here and can be revoked.
        </p>
      </section>

      <section className="card">
        <h3>
          <Icon name="download" />
          Import and export
        </h3>
        <p className="help">
          Move the library to or from other tools. Export the Karakeep file to import it into
          Karakeep (Settings → Import), or the Memos file to post with a script. Importing a
          Karakeep export adds its bookmarks as items with their tags and lists; nothing is
          researched unless you ask.
        </p>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => download('karakeep')}>
            <Icon name="download" />
            Karakeep export
          </button>
          <button type="button" className="ghost" onClick={() => download('memos')}>
            <Icon name="download" />
            Memos export
          </button>
        </div>
        <div className="divider" />
        <label className="field">
          <span className="label">After import</span>
          <select
            value={importResearch}
            onChange={(e) => setImportResearch(e.target.value as '' | 'quick' | 'standard')}
          >
            <option value="">Do nothing (free)</option>
            <option value="quick">Research each item, quick</option>
            <option value="standard">Research each item, standard</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Import Karakeep file</span>
          <input
            className="file"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void importFile(f);
            }}
          />
        </label>
        {importMsg && (
          <p className="msg-inline" role="status">
            {importMsg}
          </p>
        )}
      </section>

      <section className="card">
        <h3>
          <Icon name="key" />
          This device
        </h3>
        <div className="actions">
          <button
            type="button"
            className="ghost danger"
            onClick={() => {
              setToken(null);
              navigate('/', true);
              location.reload();
            }}
          >
            <Icon name="log-out" />
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
