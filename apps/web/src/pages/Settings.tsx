import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { ApiError, api, type Device, type IgStatus, type Status, setToken } from '../api';
import {
  apiBase,
  disableNativePush,
  enableNativePush,
  isNative,
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
  const [push, setPush] = useState<'unsupported' | 'off' | 'on' | 'busy'>(
    native || pushSupported() ? 'busy' : 'unsupported',
  );
  const [pushMsg, setPushMsg] = useState<string | null>(null);
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

  const load = () => {
    api
      .status()
      .then(setStatus)
      .catch((e) => setErr(String(e.message ?? e)));
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
    if (!native && !pushSupported()) return;
    (native ? nativePushEnabled() : pushEnabled())
      .then((on) => setPush(on ? 'on' : 'off'))
      .catch(() => setPush('off'));
  }, [native]);

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
    <div className="page stack">
      <div className="row">
        <button type="button" className="ghost" onClick={() => navigate('/')}>
          ←
        </button>
        <h3 style={{ margin: 0 }}>Settings</h3>
      </div>
      {err && <div className="msg error small">{err}</div>}

      <div className="card stack">
        <b>Server</b>
        {status ? (
          <div className="small stack" style={{ gap: 4 }}>
            {native && <div>Server: {apiBase()}</div>}
            <div>Brain: {status.brain}</div>
            <div>
              Spent today: ${status.spentTodayUsd.toFixed(3)} / cap ${status.dailyCapUsd.toFixed(2)}
            </div>
            <div>Notes exported to: {status.notesDir}</div>
            <div className="muted">
              Brain, cap and paths are configured on the server (environment / .env). See
              docs/DEPLOYMENT.md.
            </div>
          </div>
        ) : (
          <div className="muted small">Loading…</div>
        )}
      </div>

      <div className="card stack">
        <b>Notifications</b>
        <div className="small muted">
          Get a push when an answer is ready. Requires HTTPS (Tailscale serve) and, on Android, the
          installed app or PWA. The notification carries the title only, never the answer.
        </div>
        {push === 'unsupported' ? (
          <div className="small muted">This browser does not support Web Push.</div>
        ) : (
          <div className="row">
            <button type="button" disabled={push === 'busy'} onClick={togglePush}>
              {push === 'on'
                ? 'Disable on this device'
                : push === 'busy'
                  ? '…'
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
        {pushMsg && <div className="small muted">{pushMsg}</div>}
        {status && status.push.kinds.length > 0 && (
          <div className="small muted">Server push: {status.push.kinds.join(', ')}</div>
        )}
      </div>

      <div className="card stack">
        <b>Instagram</b>
        <div className="small muted">
          DM a reel to your shadow account, or @mention it in a comment, and the answer arrives
          here. Setup: docs/channels/instagram-setup.md.
        </div>
        {ig === null && <div className="small muted">Loading…</div>}
        {ig === 'off' && (
          <div className="small muted">
            Not configured on the server (set IG_APP_ID, IG_APP_SECRET and IG_WEBHOOK_VERIFY_TOKEN,
            then restart).
          </div>
        )}
        {ig && ig !== 'off' && (
          <>
            {ig.connected ? (
              <div className="small">
                Connected as <b>@{ig.username ?? ig.igUserId}</b>
                {ig.expiresAt && (
                  <span className="muted">
                    {' '}
                    · token expires {new Date(ig.expiresAt).toLocaleDateString()}
                  </span>
                )}
                {ig.refreshedAt && (
                  <span className="muted">
                    {' '}
                    · refreshed {new Date(ig.refreshedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            ) : (
              <div className="small muted">Not connected.</div>
            )}
            <div className="small muted">
              Mention polling {ig.mentionPolling ? 'on' : 'off'}
              {ig.webhookPublicHost
                ? ` · webhook host ${ig.webhookPublicHost}`
                : ' · no public webhook host set'}
            </div>
            <div className="row">
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
                    className="ghost"
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
              <div className="small muted">
                Recent events:{' '}
                {ig.recentEvents
                  .slice(0, 5)
                  .map((e) => `${e.kind}${e.error ? ' (error)' : ''}`)
                  .join(', ')}
              </div>
            )}
          </>
        )}
        {igMsg && <div className="small muted">{igMsg}</div>}
      </div>

      <div className="card stack">
        <b>Pair a device</b>
        <div className="small muted">
          Open Doubletake on the other device, choose “Pairing code”, and scan or type this code.
          Codes expire after 10 minutes and work once.
        </div>
        {pair ? (
          <div className="stack" style={{ alignItems: 'center' }}>
            <QRCodeSVG
              value={`${pair.url}/?code=${pair.code}`}
              size={196}
              bgColor="#ffffff"
              fgColor="#0f1115"
              includeMargin
            />
            <div style={{ fontSize: 28, letterSpacing: 6, fontFamily: 'ui-monospace, monospace' }}>
              {pair.code}
            </div>
            <div className="small muted">{pair.url}</div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              api
                .pairStart()
                .then(setPair)
                .catch((e) => setErr(String(e.message ?? e)))
            }
          >
            Show pairing code
          </button>
        )}
      </div>

      <div className="card stack">
        <b>Devices</b>
        {devices.map((d) => (
          <div className="row small" key={d.id}>
            <span style={{ flex: 1 }}>
              {d.name} <span className="muted">({d.platform})</span>
            </span>
            <span className="muted">
              {d.lastSeenAt ? `seen ${new Date(d.lastSeenAt).toLocaleString()}` : ''}
            </span>
            <button
              type="button"
              className="ghost"
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

      <div className="card stack">
        <b>This device</b>
        <button
          type="button"
          onClick={() => {
            setToken(null);
            navigate('/', true);
            location.reload();
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
