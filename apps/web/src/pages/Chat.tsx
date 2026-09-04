import type { ChatDetail, Mode, RunEvent } from '@doubletake/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { Claims, EntityCards, Recommendations } from '../components/AnswerCards';
import { Icon } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { RunTimeline } from '../components/RunTimeline';
import { Sources, TagEditor } from '../components/Sources';
import { useLive } from '../live';
import { navigate } from '../router';
import { CollectionPicker } from './Library';

const ACTIVE = new Set(['queued', 'extracting', 'classifying', 'researching']);

export function Chat({ id }: { id: string }) {
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [events, setEvents] = useState<Record<string, RunEvent[]>>({});
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the research menu on Escape or a click outside it.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [menu]);

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

  if (err && !detail)
    return (
      <div className="page narrow stack">
        <div className="page-head">
          <button
            type="button"
            className="ghost icon"
            onClick={() => navigate('/')}
            aria-label="Back"
          >
            <Icon name="arrow-left" />
          </button>
          <h2>Chat</h2>
        </div>
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      </div>
    );
  if (!detail)
    return (
      <div className="page narrow muted" aria-busy="true">
        Loading…
      </div>
    );

  const { chat, item, messages, runs, entities, extractions } = detail;
  const active = runs.filter((r) => ACTIVE.has(r.status));
  const totalCost = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const lastAnswer = [...messages].reverse().find((m) => m.kind === 'answer')?.structured ?? null;
  const capped = runs.some((r) => r.status === 'capped') && active.length === 0;
  const runOf = (runId: string | null | undefined) => runs.find((r) => r.id === runId);
  const host = chat.sourceUrl ? new URL(chat.sourceUrl).hostname.replace(/^www\./, '') : null;

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
    <div className="page narrow stack">
      <header className="chat-head stack tight">
        <div className="title-row">
          <button
            type="button"
            className="ghost icon"
            onClick={() => navigate('/')}
            aria-label="Back"
          >
            <Icon name="arrow-left" />
          </button>
          <h2 className="clamp-2">{chat.title}</h2>
          <span className={`status ${chat.status}`}>{chat.status}</span>
        </div>
        <div className="meta">
          {host && chat.sourceUrl && (
            <a
              href={item.canonicalUrl ?? chat.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="row"
            >
              <Icon name="external-link" size={14} />
              {host}
            </a>
          )}
          {item.modeEffective && <span>{item.modeEffective}</span>}
          {item.questionType && <span>{item.questionType.replace(/_/g, ' ')}</span>}
          {totalCost > 0 && <span className="mono">${totalCost.toFixed(3)}</span>}
          {chat.category && <span className="tag">{chat.category}</span>}
        </div>
        {item.note && <p className="small">Your note: {item.note}</p>}
      </header>

      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}
      {capped && (
        <div className="banner">
          <Icon name="info" />
          <span>
            Daily spend cap reached. This run is parked until tomorrow or until you raise the cap.
          </span>
        </div>
      )}

      <div className="messages">
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
          const run = runOf(m.runId);
          return (
            <article className="msg assistant stack" key={m.id}>
              <Markdown>{m.content}</Markdown>
              {m.structured && m.kind === 'answer' && (
                <>
                  <Claims claims={m.structured.claims} />
                  <Recommendations items={m.structured.recommendations} />
                </>
              )}
              {run && (
                <div className="foot">
                  {run.mode} · {run.costUsd != null ? `$${run.costUsd.toFixed(3)}` : 'cost n/a'}
                </div>
              )}
            </article>
          );
        })}
        {lastAnswer && <EntityCards entities={entities} />}
        {active.map((r) => (
          <div className="card quiet stack tight" key={r.id}>
            <div className="row small">
              <span className={`status ${r.status}`}>{r.status}</span>
              <span className="muted grow">
                {r.kind} · {r.mode}
              </span>
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

      <details className="card">
        <summary>
          <Icon name="bookmark-search" />
          <span className="grow">Tags, collections and sources</span>
          <Icon name="chevron-down" className="chev" />
        </summary>
        <div className="stack">
          <div className="field">
            <span className="label">Tags</span>
            <TagEditor
              tags={chat.tags}
              onAdd={async (name) => {
                try {
                  await api.addTag(id, name);
                  load();
                } catch (ex) {
                  setErr(ex instanceof ApiError ? ex.message : String(ex));
                }
              }}
              onRemove={async (name) => {
                try {
                  await api.removeTag(id, name);
                  load();
                } catch (ex) {
                  setErr(ex instanceof ApiError ? ex.message : String(ex));
                }
              }}
            />
          </div>
          <div className="field">
            <span className="label">Collections</span>
            <CollectionPicker chatId={id} />
          </div>
          <Sources extractions={extractions} />
        </div>
      </details>

      <form className="composer" onSubmit={send}>
        <div className="bar">
          <textarea
            aria-label="Follow-up question"
            placeholder="Ask a follow-up…"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="popover-anchor" ref={menuRef}>
            <button
              type="button"
              className="ghost icon"
              onClick={() => setMenu(!menu)}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label="Run a full research pass"
              title="Research this"
            >
              <Icon name="sparkles" />
            </button>
            {menu && (
              <div className="popover" role="menu" aria-label="Research this">
                <div className="head">Research this</div>
                <button type="button" role="menuitem" onClick={() => research('quick')}>
                  Quick <span className="help muted small">&lt; 90 s</span>
                </button>
                <button type="button" role="menuitem" onClick={() => research('standard')}>
                  Standard <span className="help muted small">~5 min</span>
                </button>
                <button type="button" role="menuitem" onClick={() => research('deep')}>
                  Deep <span className="help muted small">~20 min</span>
                </button>
              </div>
            )}
          </div>
          <button type="submit" className="primary icon" disabled={!draft.trim()} aria-label="Send">
            <Icon name="send" />
          </button>
        </div>
      </form>
    </div>
  );
}
