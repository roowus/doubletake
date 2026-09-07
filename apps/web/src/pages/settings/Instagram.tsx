import { useEffect, useState } from 'react';
import { ApiError, api, type IgStatus } from '../../api';
import { Confirm } from '../../components/Confirm';
import { errText, Group, Note, Row, SettingsPage } from './parts';

/** Settings → Instagram: the connected account, its token, comment access and mention polling. */
export function InstagramSettings() {
  const [ig, setIg] = useState<IgStatus | 'off' | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  // The OAuth callback lands back here with ?ig=connected or ?ig=error&message=…
  const [msg, setMsg] = useState<string | null>(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('ig') === 'connected') return 'Instagram connected.';
    if (q.get('ig') === 'error') return `Instagram: ${q.get('message') ?? 'connection failed'}`;
    return null;
  });
  const load = () =>
    api
      .igStatus()
      .then(setIg)
      .catch((e) => setIg(e instanceof ApiError && e.status === 404 ? 'off' : null));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);
  const fail = (e: unknown) => setMsg(errText(e));

  return (
    <SettingsPage
      title="Instagram"
      intro="Share a post to the connected account, or @mention it in a comment, and it lands in your inbox."
    >
      {ig === null && <p className="muted small">Loading…</p>}
      {ig === 'off' && (
        <Group foot="Set IG_APP_ID and IG_APP_SECRET on the server and restart; see docs/channels/instagram.md.">
          <Row icon="instagram" label="Not set up on this server" />
        </Group>
      )}
      {ig && ig !== 'off' && (
        <>
          <Group title="Account">
            <Row
              icon="instagram"
              label={ig.connected ? `@${ig.username ?? ig.igUserId}` : 'No account connected'}
              status={ig.connected ? 'ok' : 'warn'}
              value={ig.connected ? 'Connected' : ''}
            />
            {ig.connected && ig.expiresAt && (
              <Row label="Token expires" value={new Date(ig.expiresAt).toLocaleDateString()} />
            )}
            {ig.connected && ig.refreshedAt && (
              <Row label="Last refreshed" value={new Date(ig.refreshedAt).toLocaleDateString()} />
            )}
            <Row label="Mention polling" value={ig.mentionPolling ? 'On' : 'Off'} />
            <Row label="Webhook host" value={ig.webhookPublicHost ?? 'Not set'} />
          </Group>

          <Group title="Actions">
            {ig.connected ? (
              <>
                <Row
                  label="Poll mentions now"
                  hint="Ask Graph for new @mentions without waiting for the webhook"
                  onClick={() =>
                    api
                      .igPoll()
                      .then((r) =>
                        setMsg(
                          `Poll: ${r.handled.length} new, ${r.duplicates} seen before, ${r.ignored} ignored.`,
                        ),
                      )
                      .catch(fail)
                  }
                />
                <Row
                  label="Check comment access"
                  hint="Verifies the webhook fields and re-subscribes if needed"
                  onClick={() =>
                    api
                      .igVerify()
                      .then((r) =>
                        setMsg(
                          r.commentsOk
                            ? `Comments OK: webhook covers ${r.subscribedFields.join(', ')}${r.resubscribed ? ' (re-subscribed)' : ''}.`
                            : `Comments not ready: ${
                                r.missingFields.length
                                  ? `webhook missing ${r.missingFields.join(', ')}`
                                  : 'comment scope refused'
                              }${Object.values(r.errors).length ? `. ${Object.values(r.errors).join('; ')}` : ''}`,
                        ),
                      )
                      .catch(fail)
                  }
                />
                <Row
                  label="Refresh token"
                  onClick={() =>
                    api
                      .igRefresh()
                      .then((s) => {
                        setIg(s);
                        setMsg('Token refreshed.');
                      })
                      .catch(fail)
                  }
                />
                <Row label="Disconnect" danger onClick={() => setConfirmOff(true)} />
              </>
            ) : (
              <Row
                icon="link"
                label="Connect Instagram"
                hint="Opens Meta's login in this tab"
                onClick={() =>
                  api
                    .igConnect()
                    .then((r) => {
                      location.href = r.url;
                    })
                    .catch(fail)
                }
              />
            )}
          </Group>

          {ig.recentEvents.length > 0 && (
            <Group title="Recent events">
              {ig.recentEvents.slice(0, 5).map((e) => (
                <Row
                  key={e.id}
                  label={e.kind}
                  hint={new Date(e.receivedAt).toLocaleString()}
                  status={e.error ? 'err' : 'ok'}
                  value={e.error ? 'Error' : ''}
                />
              ))}
            </Group>
          )}
        </>
      )}
      <Note>{msg}</Note>
      <Confirm
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Disconnect Instagram?"
        body="Shares and mentions stop arriving until you connect again. Saved items stay."
        action="Disconnect"
        onConfirm={() =>
          api
            .igDisconnect()
            .then(() => {
              setMsg('Disconnected.');
              void load();
            })
            .catch(fail)
        }
      />
    </SettingsPage>
  );
}
