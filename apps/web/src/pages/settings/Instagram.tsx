import { useEffect, useState } from 'react';
import { ApiError, api, type IgLinkStatus, type IgPairingCode, type IgStatus } from '../../api';
import { Confirm } from '../../components/Confirm';
import { toast } from '../../components/Toast';
import { countdown } from '../../format';
import { useHosted } from '../../lib/hosted';
import { errText, Group, Note, Row, SettingsPage } from './parts';

/** The communal hosted account unpaired senders are told to DM; the prompt names it too. */
const SHARED_IG_ACCOUNT = '@dt.save';

/** 8 chars from an unambiguous alphabet (no 0/O/1/I); server-side TTL is 15 minutes. */
function CodeBlock({ code }: { code: IgPairingCode }) {
  const [left, setLeft] = useState(() => Date.parse(code.expiresAt) - Date.now());
  // Re-tick once a second while a code is on screen; the interval dies with the component.
  useEffect(() => {
    setLeft(Date.parse(code.expiresAt) - Date.now());
    const t = setInterval(() => setLeft(Date.parse(code.expiresAt) - Date.now()), 1000);
    return () => clearInterval(t);
  }, [code.expiresAt]);
  const expired = left <= 0;
  const instruction = `To save this: connect your account at doubletake.gg → Settings → Instagram, then DM me the code it shows.`;
  return (
    <div className="srow stack">
      <div className="pair-block">
        <div className="pair-code" data-expired={expired ? '' : undefined}>
          {code.code}
        </div>
        <p className="help" aria-live="polite">
          {expired ? 'This code has expired. Generate a new one.' : `Expires in ${countdown(left)}`}
        </p>
      </div>
      <div className="row">
        <button
          type="button"
          className="ghost small"
          disabled={expired}
          onClick={() => {
            void navigator.clipboard?.writeText(code.code);
            toast('Code copied', 'Now DM it to the Doubletake account.');
          }}
        >
          Copy code
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            void navigator.clipboard?.writeText(instruction);
            toast('Message copied', 'Paste it into the DM if you like.');
          }}
        >
          Copy the DM
        </button>
      </div>
    </div>
  );
}

/**
 * Settings → Instagram on the hosted service (ADR 0032): pair your own Instagram account with
 * the communal Doubletake account. Three steps, one code; the code is single-use and expiring,
 * so it is shown large with a live countdown and can be regenerated at any time.
 */
export function HostedInstagramSettings() {
  const [state, setState] = useState<IgLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isErr, setIsErr] = useState(false);

  const load = () =>
    api
      .igLinkStatus()
      .then(setState)
      .catch((e) => {
        setIsErr(true);
        setMsg(errText(e));
      });
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setBusy(true);
    setIsErr(false);
    setMsg(null);
    try {
      const code = await api.igCreateLink();
      setState({ linked: false, code: code.code, expiresAt: code.expiresAt });
    } catch (e) {
      setIsErr(true);
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage
      title="Instagram"
      intro="Send a post to the Doubletake account on Instagram and it lands in your library."
    >
      {state === null && <p className="muted small">Loading…</p>}

      {state?.linked === true && (
        <Group
          title="Linked account"
          foot="Reels and posts you send after unlinking are not saved."
        >
          <Row
            icon="instagram"
            label={state.igUsername ? `@${state.igUsername}` : 'Instagram account'}
            hint="Anything this account DMs or shares is saved to your library"
            status="ok"
            value="Linked"
          />
          {state.linkedAt && (
            <Row label="Linked" value={new Date(state.linkedAt).toLocaleDateString()} />
          )}
          <Row
            label="Unlink"
            hint="Stops saving from this Instagram account"
            danger
            onClick={() => setUnlinkOpen(true)}
          />
        </Group>
      )}

      {state?.linked === false && (
        <Group
          title="Connect Instagram"
          foot="The code is single-use and works for one Instagram account."
        >
          {state.code && state.expiresAt ? (
            <CodeBlock code={{ code: state.code, expiresAt: state.expiresAt }} />
          ) : (
            <div className="srow stack">
              <span className="srow-text">
                <span className="srow-label">No code yet</span>
                <span className="srow-hint">
                  Get one, then DM it to {SHARED_IG_ACCOUNT} to pair your account.
                </span>
              </span>
            </div>
          )}
          <div className="srow stack">
            <ol className="steps">
              <li>
                Tap Connect and copy the code it shows. It lasts 15 minutes; Connect again for a
                fresh one.
              </li>
              <li>DM that code to {SHARED_IG_ACCOUNT} from the Instagram account you save with.</li>
              <li>From then on, anything you send that account lands in your library.</li>
            </ol>
            <button type="button" className="primary" disabled={busy} onClick={() => void create()}>
              {busy ? 'Connecting…' : state.code ? 'Connect again' : 'Connect'}
            </button>
          </div>
        </Group>
      )}

      <Note error={isErr}>{msg}</Note>

      <Confirm
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title="Unlink this Instagram account?"
        body="Reels you send after unlinking won't be saved. You can connect again at any time."
        action="Unlink"
        onConfirm={() =>
          api
            .igUnlink()
            .then(() => {
              toast('Instagram unlinked');
              return load();
            })
            .catch((e) => {
              setIsErr(true);
              setMsg(errText(e));
            })
        }
      />
    </SettingsPage>
  );
}

/** Settings → Instagram: the connected account, its token, comment access and mention polling. */
export function InstagramSettings() {
  const hosted = useHosted();
  if (hosted?.hosted === true) return <HostedInstagramSettings />;
  return <SelfHostedInstagramSettings />;
}

/** Settings → Instagram (self-hosted): connect your own account, poll mentions, set a webhook. */
function SelfHostedInstagramSettings() {
  const [ig, setIg] = useState<IgStatus | 'off' | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  // The OAuth callback lands back here with ?ig=connected or ?ig=error&message=…
  const [msg, setMsg] = useState<string | null>(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('ig') === 'error') return `Instagram: ${q.get('message') ?? 'connection failed'}`;
    return null;
  });
  const [isErr, setIsErr] = useState(
    () => new URLSearchParams(location.search).get('ig') === 'error',
  );
  useEffect(() => {
    if (new URLSearchParams(location.search).get('ig') === 'connected')
      toast('Instagram connected');
  }, []);
  const load = () =>
    api
      .igStatus()
      .then(setIg)
      .catch((e) => setIg(e instanceof ApiError && e.status === 404 ? 'off' : null));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);
  const note = (m: string) => {
    setIsErr(false);
    setMsg(m);
  };
  const fail = (e: unknown) => {
    setIsErr(true);
    setMsg(errText(e));
  };

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
                        note(
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
                        note(
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
                        toast('Token refreshed');
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
      <Note error={isErr}>{msg}</Note>
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
              toast('Instagram disconnected');
              void load();
            })
            .catch(fail)
        }
      />
    </SettingsPage>
  );
}
