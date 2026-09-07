import type { ChatDetail, Mode, RunEvent } from '@doubletake/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { AnswerSkeleton, Turn } from '../components/Answer';
import { ACTIVE, AnswerTabs } from '../components/AnswerTabs';
import { ChatHeader } from '../components/ChatHeader';
import { ClipCard } from '../components/ClipCard';
import { FollowUp } from '../components/FollowUp';
import { Icon } from '../components/Icon';
import type { MenuAction } from '../components/Menu';
import { Sheet } from '../components/Sheet';
import { TagEditor } from '../components/TagEditor';
import { useLive } from '../live';
import { navigate } from '../router';
import { CollectionPicker } from './Entities';

/** Phases a run passes through, for the margin rail's fill while it is live. */
const PHASE_PCT: Record<string, number> = {
  queued: 5,
  extracting: 25,
  classifying: 45,
  researching: 70,
};

/**
 * The answer page: a notebook page about one shared thing. Clip on top, the owner's note,
 * then the brain's answer as full-width prose beside the margin rail (the accent rule that
 * marks where the answer starts and fills while a run is live), the four detail tabs, and
 * the follow-up composer stuck to the bottom.
 */
export function Chat({ id }: { id: string }) {
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [events, setEvents] = useState<Record<string, RunEvent[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'tags' | 'collections' | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadEvents = (runId: string) => {
    api
      .runEvents(id, runId)
      .then((ev) => setEvents((m) => ({ ...m, [runId]: ev.events })))
      .catch(() => {});
  };
  const load = async () => {
    try {
      const d = await api.chat(id);
      setDetail(d);
      setErr(null);
      if (d.chat.unreadCount > 0) api.markRead(id).catch(() => {});
      // Backfill the timeline of any still-active run so a reload shows what happened so far.
      for (const r of d.runs.filter((r) => ACTIVE.has(r.status))) loadEvents(r.id);
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

  // A new turn scrolls into view; live run events do not (the Run tab has its own scroll).
  const msgCount = detail?.messages.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any new message
  useEffect(() => {
    if (msgCount > 1) bottom.current?.scrollIntoView({ block: 'end' });
  }, [msgCount]);

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
        <button type="button" className="primary" onClick={() => load()}>
          Retry
        </button>
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
  const liveRun = active[0];
  // Rail fill: the phase gives a floor, tool events nudge it towards the top of the phase.
  const railPct = liveRun
    ? Math.min(
        95,
        (PHASE_PCT[liveRun.status] ?? 10) + Math.min(20, (events[liveRun.id]?.length ?? 0) * 2),
      )
    : 100;
  const hasAnswer = messages.some((m) => m.role === 'assistant');

  const fail = (ex: unknown) => setErr(ex instanceof ApiError ? ex.message : String(ex));
  async function send(content: string) {
    try {
      await api.sendMessage(id, content);
      load();
    } catch (ex) {
      fail(ex);
    }
  }
  async function research(mode: Mode, adapter: string | null) {
    try {
      await api.research(id, mode, undefined, adapter ?? undefined);
      load();
    } catch (ex) {
      fail(ex);
    }
  }
  const actions: (MenuAction | 'separator')[] = [
    { label: 'Tags…', icon: 'tag', onSelect: () => setSheet('tags') },
    { label: 'Collections…', icon: 'folder', onSelect: () => setSheet('collections') },
    'separator',
    {
      label: 'Research again, deeper',
      icon: 'compass',
      disabled: active.length > 0,
      onSelect: () => void research(item.modeEffective === 'deep' ? 'deep' : 'standard', null),
    },
  ];

  return (
    <div className="page narrow notebook" data-live={liveRun ? '' : undefined}>
      <ChatHeader
        chat={chat}
        item={item}
        totalCost={totalCost}
        onBack={() => navigate('/')}
        actions={actions}
      />

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

      <ClipCard chat={chat} item={item} />
      {chat.tags.length > 0 && (
        <ul className="chips chat-tags" aria-label="Tags">
          {chat.tags.map((t) => (
            <li key={t}>
              <button type="button" className="tag" onClick={() => setSheet('tags')}>
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="turns rail" data-rail-pct={Math.round(railPct / 10) * 10}>
        {messages.map((m) => (
          <Turn msg={m} run={runOf(m.runId)} key={m.id} />
        ))}
        {liveRun && (
          <div className="turn answer live">
            <div className="turn-label">
              <span className={`status ${liveRun.status}`}>{liveRun.status}</span>
              <span>{liveRun.mode}</span>
              {liveRun.pinned && <span>{liveRun.adapter}</span>}
              <span className="grow" />
              <button
                type="button"
                className="ghost small"
                onClick={() => api.cancelRun(liveRun.id).then(load).catch(fail)}
              >
                Cancel
              </button>
            </div>
            <AnswerSkeleton />
          </div>
        )}
        {!hasAnswer && !liveRun && (
          <div className="turn system">
            <Icon name="info" size={14} />
            <span>No answer yet. Research this from the compass below.</span>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <AnswerTabs
        claims={lastAnswer?.claims ?? []}
        entities={entities}
        extractions={extractions}
        runs={runs}
        events={events}
        onOpenRun={loadEvents}
        onCancel={(runId) => api.cancelRun(runId).then(load).catch(fail)}
      />

      <FollowUp onSend={send} onResearch={research} busy={active.length > 0} />

      <Sheet
        open={sheet === 'tags'}
        onOpenChange={(o) => setSheet(o ? 'tags' : null)}
        title="Tags"
        description="Tags from the brain are plain; ones you add are dashed and never overwritten."
      >
        <TagEditor
          tags={chat.tags}
          onAdd={async (name) => {
            try {
              await api.addTag(id, name);
              load();
            } catch (ex) {
              fail(ex);
            }
          }}
          onRemove={async (name) => {
            try {
              await api.removeTag(id, name);
              load();
            } catch (ex) {
              fail(ex);
            }
          }}
        />
      </Sheet>
      <Sheet
        open={sheet === 'collections'}
        onOpenChange={(o) => setSheet(o ? 'collections' : null)}
        title="Collections"
        description="Manual lists this page belongs to. Smart collections pick it up on their own."
      >
        <CollectionPicker chatId={id} />
      </Sheet>
    </div>
  );
}
