import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { api, type Device, setToken } from '../../api';
import { Confirm } from '../../components/Confirm';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { seen } from '../../format';
import { apiBase, isNative } from '../../native';
import { navigate } from '../../router';
import { errText, Group, Note, Row, SettingsPage } from './parts';

/** Settings → Devices: this device, pairing another one, revoking paired devices and agents. */
export function DevicesSettings() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [pair, setPair] = useState<{ code: string; expiresAt: string; url: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<Device | null>(null);
  const [signOut, setSignOut] = useState(false);
  const load = () =>
    api
      .devices()
      .then(setDevices)
      .catch((e) => setMsg(errText(e)));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  return (
    <SettingsPage title="Devices">
      <Group title="This device">
        {isNative() && <Row label="Server" value={<span className="mono">{apiBase()}</span>} />}
        <Row
          icon="log-out"
          label="Sign out"
          hint="Forget this device's token; pair again to come back."
          onClick={() => setSignOut(true)}
          danger
        />
      </Group>

      <Group
        title="Pair another device"
        foot="Open Doubletake on the other device, choose “Pairing code”, then scan or type this code. Codes expire after 10 minutes and work once."
      >
        {pair ? (
          <div className="pair-block">
            <div className="qr">
              <QRCodeSVG
                value={`${pair.url}/?code=${pair.code}`}
                size={196}
                bgColor="#ffffff"
                fgColor="#1c1b18"
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
          <Row
            icon="smartphone"
            label="Show pairing code"
            hint="QR and a short code, valid for 10 minutes"
            onClick={() =>
              api
                .pairStart()
                .then(setPair)
                .catch((e) => setMsg(errText(e)))
            }
          />
        )}
      </Group>

      <Group
        title="Paired devices and agents"
        foot={
          <>
            Other agents (Claude Code, Claude Desktop, …) pair the same way, then point their MCP
            client at <code>{window.location.origin}/mcp</code> with{' '}
            <code>Authorization: Bearer &lt;token&gt;</code>. They appear here and can be revoked.
          </>
        }
      >
        {devices === null && (
          <div className="srow muted" aria-busy="true">
            Loading…
          </div>
        )}
        {devices?.length === 0 && <div className="srow muted">No paired devices yet.</div>}
        {devices?.map((d) => (
          <div className="srow" key={d.id}>
            <Icon
              name={d.platform === 'android' || d.platform === 'ios' ? 'smartphone' : 'monitor'}
              className="srow-icon"
            />
            <span className="srow-text">
              <span className="srow-label truncate">{d.name}</span>
              <span className="srow-hint">
                {d.platform}
                {d.lastSeenAt ? ` · ${seen(d.lastSeenAt)}` : ''}
              </span>
            </span>
            <button
              type="button"
              className="ghost small danger"
              onClick={() => setRevoke(d)}
              aria-label={`Revoke ${d.name}`}
            >
              Revoke
            </button>
          </div>
        ))}
      </Group>
      <Note error>{msg}</Note>

      <Confirm
        open={revoke !== null}
        onOpenChange={(o) => !o && setRevoke(null)}
        title={`Revoke ${revoke?.name ?? 'device'}?`}
        body="It stops receiving pushes and its token stops working right away. Pair it again to bring it back."
        action="Revoke"
        onConfirm={() =>
          revoke
            ? api
                .revokeDevice(revoke.id)
                .then(() => {
                  toast(`${revoke.name} revoked`);
                  load();
                })
                .catch((e) => setMsg(errText(e)))
            : undefined
        }
      />
      <Confirm
        open={signOut}
        onOpenChange={setSignOut}
        title="Sign out of this device?"
        body="Your library stays on the server. You will need a pairing code to sign back in."
        action="Sign out"
        onConfirm={() => {
          setToken(null);
          navigate('/', true);
          location.reload();
        }}
      />
    </SettingsPage>
  );
}
