import type { ChatDetail, Mode, RunEvent } from '@doubletake/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { Claims, EntityCards, Recommendations } from '../components/AnswerCards';
import { Markdown } from '../components/Markdown';
import { RunTimeline } from '../components/RunTimeline';
import { useLive } from '../live';
import { navigate } from '../router';

const ACTIVE = new Set(['queued', 'extracting', 'classifying', 'researching']);

export function Chat({ id }: { id: string }) {
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [events, setEvents] = useState<Record<string, RunEvent[]>>({});
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const d = await api.chat(id);
      setDetail(d);
      setErr(null);
      if (d.chat.unreadCount > 0) api.markRead(id).catch(() => {});
      // Backfill the timeline of any still-active run so a reload shows what happened so far.
      for (const r of d.runs.filter((r) => ACTIVE.has(r.status))) {
        api
          .runEvents(id, r.id)
          .then((ev) => setEvents((m) => ({ ...m, [r.id]: ev.events })))
          .catch(() => {});
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload on id change only
  useEffect(() => {
    setDetail(null);
    setEvents({});
    load();
  }, [id]);

  useLive((e) => {
    if (e.kind === 'run_event' && e.chatId === id) {
      setEvents((m) => {
        const list = m[e.runId] ?? [];
        if (list.some((x) => x.seq === e.seq)) return m;
        return { ...m, [e.runId]: [...list, e] };
      });
      if (e.type === 'done' || e.type === 'error') load();
    } else if (e.kind === 'chat_updated' && e.chatId === id) load();
  });

  const msgCount = detail?.messages.length ?? 0;
  const eventCount = events.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any new message/event
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [msgCount, eventCount]);

  if (err) return <div className="page msg error">{err}</div>;
  if (!detail) return <div className="page muted">Loading…</div>;

  const { chat, item, messages, runs, entities } = detail;
  const active = runs.filter((r) => ACTIVE.has(r.status));
  const totalCost = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const lastAnswer = [...messages].reverse().find((m) => m.kind === 'answer')?.structured ?? null;
  const capped = runs.some((r) => r.status === 'capped') && active.length === 0;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    try {
      await api.sendMessage(id, content);
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }
  async function research(mode?: Mode) {
    setMenu(false);
    try {
      await api.research(id, mode);
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }

  return (
    <div className="page stack">
      <div className="card stack" style={{ gap: 6 }}>
        <div className="row">
          <button type="button" className="ghost" onClick={() => navigate('/')} title="Back">
            ←
          </button>
          <h3 style={{ margin: 0, flex: 1 }}>{chat.title}</h3>
          <span className={`status ${chat.status}`}>{chat.status}</span>
        </div>
        <div className="row small muted">
          {chat.sourceUrl && (
            <a href={item.canonicalUrl ?? chat.sourceUrl} target="_blank" rel="noopener noreferrer">
              {new URL(chat.sourceUrl).hostname}
            </a>
          )}
          {item.modeEffective && <span>mode: {item.modeEffective}</span>}
          {item.questionType && <span>{item.questionType.replace(/_/g, ' ')}</span>}
          {totalCost > 0 && <span>${totalCost.toFixed(3)}</span>}
          {chat.category && <span className="tag">{chat.category}</span>}
          {chat.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
        {item.note && <div className="small">Note: {item.note}</div>}
      </div>

      {capped && (
        <div className="banner small">
          Daily spend cap reached. This run is parked until tomorrow or until you raise the cap.
        </div>
      )}

      <div className="stack">
        {messages.map((m) => {
          if (m.role === 'system')
            return (
              <div className={`msg system ${m.kind === 'error' ? 'error' : ''}`} key={m.id}>
                {m.content}
              </div>
            );
          if (m.role === 'user')
            return (
              <div className="msg user" key={m.id}>
                {m.content}
              </div>
            );
          return (
            <div className="msg assistant stack" key={m.id}>
              <Markdown>{m.content}</Markdown>
              {m.structured && m.kind === 'answer' && (
                <>
                  <Claims claims={m.structured.claims} />
                  <Recommendations items={m.structured.recommendations} />
                </>
              )}
              {m.runId && (
                <div className="small muted">
                  {runs.find((r) => r.id === m.runId)?.mode} ·{' '}
                  {runs.find((r) => r.id === m.runId)?.costUsd != null
                    ? `$${runs.find((r) => r.id === m.runId)?.costUsd?.toFixed(3)}`
                    : 'cost n/a'}
                </div>
              )}
            </div>
          );
        })}
        {lastAnswer && <EntityCards entities={entities} />}
        {active.map((r) => (
          <div className="stack" key={r.id}>
            <div className="row small">
              <span className={`status ${r.status}`}>{r.status}</span>
              <span className="muted">
                {r.kind} · {r.mode}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="ghost small"
                onClick={() => api.cancelRun(r.id).then(load)}
              >
                Cancel
              </button>
            </div>
            <RunTimeline events={events[r.id] ?? []} />
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form className="composer" onSubmit={send}>
        <textarea
          placeholder="Ask a follow-up…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="primary" disabled={!draft.trim()}>
          Send
        </button>
        <div style={{ position: 'relative' }}>
          <button type="button" onClick={() => setMenu(!menu)} title="Run a full research pass">
            Research this ▾
          </button>
          {menu && (
            <div
              className="card stack"
              style={{ position: 'absolute', bottom: '110%', right: 0, gap: 4, minWidth: 180 }}
            >
              <button type="button" className="ghost" onClick={() => research('quick')}>
                Quick
              </button>
              <button type="button" className="ghost" onClick={() => research('standard')}>
                Standard
              </button>
              <button type="button" className="ghost" onClick={() => research('deep')}>
                Deep
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
