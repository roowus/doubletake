import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { api, type Device, type Status, setToken } from '../api';
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
