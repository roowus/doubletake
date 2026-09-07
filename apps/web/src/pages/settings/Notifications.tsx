import { useEffect, useState } from 'react';
import { api, type QuietHours, type Status } from '../../api';
import { toast } from '../../components/Toast';
import {
  disableNativePush,
  enableNativePush,
  isNative,
  nativePlatform,
  nativePushEnabled,
} from '../../native';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../../push';
import { errText, Group, Note, Row, SettingsPage, Switch } from './parts';

type PushState = 'unsupported' | 'off' | 'on' | 'busy';

/** Settings → Notifications: push on this device, a test, owner channels, quiet hours. */
export function NotificationsSettings() {
  const native = isNative();
  // No APNs in v1 (ADR 0027): the iOS app shows the limitation instead of a toggle.
  const ios = native && nativePlatform() === 'ios';
  const [status, setStatus] = useState<Status | null>(null);
  const [push, setPush] = useState<PushState>(
    ios ? 'unsupported' : native || pushSupported() ? 'busy' : 'unsupported',
  );
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const [quietMsg, setQuietMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = () =>
    api
      .status('skip')
      .then((st) => {
        setStatus(st);
        setQuiet((q) => q ?? st.push.quietHours);
      })
      .catch((e) => setPushMsg(errText(e)));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (ios || (!native && !pushSupported())) return;
    (native ? nativePushEnabled() : pushEnabled())
      .then((on) => setPush(on ? 'on' : 'off'))
      .catch(() => setPush('off'));
  }, [native, ios]);

  const togglePush = async (on: boolean) => {
    setPushMsg(null);
    const was = push;
    setPush('busy');
    try {
      if (!on) {
        await (native ? disableNativePush() : disablePush());
        setPush('off');
      } else if (native) {
        if (!status?.push.kinds.includes('fcm'))
          throw new Error('The server has no FCM credentials (set FCM_SERVICE_ACCOUNT_PATH).');
        await enableNativePush();
        setPush('on');
        toast('Notifications enabled on this device');
      } else {
        const key = status?.push.vapidPublicKey;
        if (!key) throw new Error('The server has no Web Push key (is webpush configured?).');
        await enablePush(key);
        setPush('on');
        toast('Notifications enabled on this device');
      }
    } catch (e) {
      setPush(was === 'on' ? 'on' : 'off');
      setPushMsg(errText(e));
    }
  };
  const edit = (patch: Partial<QuietHours>) => {
    if (!quiet) return;
    setQuiet({ ...quiet, ...patch });
    setDirty(true);
  };

  return (
    <SettingsPage
      title="Notifications"
      intro="A push when an answer is ready. It carries the title only, never the answer."
    >
      <Group
        title="This device"
        foot={
          push === 'unsupported'
            ? ios
              ? 'The iOS app has no push yet (no APNs in v1). Set up ntfy or Telegram on the server to be notified on this phone.'
              : 'This browser does not support Web Push. Install the app or use Chrome, Edge or Safari 16.4+ over HTTPS.'
            : 'Needs HTTPS (Tailscale serve) and, on Android, the installed app or PWA.'
        }
      >
        <Row
          icon="bell"
          label="Push notifications"
          hint={push === 'busy' ? 'Working…' : push === 'on' ? 'On for this device' : 'Off'}
          control={
            <Switch
              label="Push notifications on this device"
              checked={push === 'on'}
              disabled={push === 'busy' || push === 'unsupported'}
              onChange={(on) => void togglePush(on)}
            />
          }
        />
        {push === 'on' && (
          <Row
            label="Send a test"
            hint="One notification to this device"
            onClick={() =>
              api
                .pushTest()
                .then((r) =>
                  r.sent > 0
                    ? toast('Test sent')
                    : setPushMsg(
                        `Nothing sent (gone ${r.gone}, failed ${r.failed}). Turn push off and on again.`,
                      ),
                )
                .catch((e) => setPushMsg(errText(e)))
            }
          />
        )}
        <Note error>{pushMsg}</Note>
      </Group>

      {status && (status.push.kinds.length > 0 || status.push.channels.length > 0) && (
        <Group
          title="Server"
          foot="Owner channels (ntfy, Telegram) are set in the server's environment and reach you without a paired device."
        >
          {status.push.kinds.length > 0 && (
            <Row label="Push transports" value={status.push.kinds.join(', ')} />
          )}
          {status.push.channels.length > 0 && (
            <>
              <Row label="Owner channels" value={status.push.channels.join(', ')} />
              <Row
                label="Send a test to channels"
                onClick={() =>
                  api
                    .pushChannelsTest()
                    .then((r) =>
                      r.failed === 0
                        ? toast(`Sent to ${r.sent} channel${r.sent === 1 ? '' : 's'}`)
                        : setPushMsg(`${r.failed} channel(s) failed. See the server log.`),
                    )
                    .catch((e) => setPushMsg(errText(e)))
                }
              />
            </>
          )}
        </Group>
      )}

      {status && quiet && (
        <Group
          title="Quiet hours"
          foot="Notifications inside the window are held and sent as one digest when it ends."
        >
          <Row
            icon="moon"
            label="Quiet hours"
            hint={quiet.enabled ? `${quiet.start} to ${quiet.end}, ${quiet.timeZone}` : 'Off'}
            control={
              <Switch
                label="Quiet hours"
                checked={quiet.enabled}
                onChange={(on) => edit({ enabled: on })}
              />
            }
          />
          {quiet.enabled && (
            <div className="srow stack quiet-hours">
              <div className="times">
                <label className="field">
                  <span className="label">From</span>
                  <input
                    type="time"
                    value={quiet.start}
                    onChange={(e) => edit({ start: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="label">To</span>
                  <input
                    type="time"
                    value={quiet.end}
                    onChange={(e) => edit({ end: e.target.value })}
                  />
                </label>
              </div>
              <label className="field">
                <span className="label">Time zone</span>
                <input
                  className="tz"
                  value={quiet.timeZone}
                  onChange={(e) => edit({ timeZone: e.target.value })}
                  list="tz-list"
                />
                <datalist id="tz-list">
                  {[Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC'].map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </label>
            </div>
          )}
          {dirty && (
            <Row
              label="Save quiet hours"
              onClick={() =>
                api
                  .setQuietHours(quiet)
                  .then((r) => {
                    setQuiet(r.quietHours);
                    setDirty(false);
                    toast('Quiet hours saved');
                    void load();
                  })
                  .catch((e) => setQuietMsg(errText(e)))
              }
            />
          )}
          {status.push.pending > 0 && (
            <Row
              label={`Send digest now (${status.push.pending} waiting)`}
              onClick={() =>
                api
                  .flushDigest()
                  .then((r) => {
                    toast(`Digest sent to ${r.sent} device${r.sent === 1 ? '' : 's'}`);
                    void load();
                  })
                  .catch((e) => setQuietMsg(errText(e)))
              }
            />
          )}
          <Note error>{quietMsg}</Note>
        </Group>
      )}
    </SettingsPage>
  );
}
