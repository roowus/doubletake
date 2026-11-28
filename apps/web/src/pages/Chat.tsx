import type { ChatDetail, Entity, Mode, RunDto, RunEvent } from '@doubletake/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { AnswerSkeleton, Claims, isBareShare, SourcesReport, Turn } from '../components/Answer';
import { ACTIVE, AnswerTabs } from '../components/AnswerTabs';
import { ChatHeader } from '../components/ChatHeader';
import { FollowUp } from '../components/FollowUp';
import { Icon } from '../components/Icon';
import type { MenuAction } from '../components/Menu';
import { Sheet } from '../components/Sheet';
import { ListSkeleton } from '../components/Skeleton';
import { SourceLine } from '../components/SourceLine';
import { TagEditor } from '../components/TagEditor';
import { TaskForm } from '../components/TaskForm';
import { toast } from '../components/Toast';
import { failureCopy } from '../lib/hosted';
import { useLive } from '../live';
import { navigate } from '../router';
import { CollectionPicker } from './Entities';

/** "run 12 s · $0.04" for the footer row: the run's duration and what it cost. */
function runFooter(run: RunDto): string {
  const parts: string[] = [];
  if (run.startedAt && run.finishedAt) {
    const s = Math.round(
      (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
    );
    parts.push(s >= 90 ? `run ${Math.round(s / 60)} min` : `run ${s} s`);
  }
  if (run.costUsd != null) parts.push(`$${run.costUsd.toFixed(2)}`);
  return parts.join(' · ');
}

/**
 * The answer page (ADR 0034): a source line, the title, the prose with its evidence marks, the
 * claims and sources reports printed underneath, one footer row for everything else, and the
 * follow-up composer stuck to the bottom. No turn labels on the answer, no rail, no tabs.
 */
export function Chat({ id }: { id: string }) {
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [events, setEvents] = useState<Record<string, RunEvent[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'tags' | 'collections' | 'task' | 'detail' | null>(null);
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
      <div className="page narrow notebook">
        <ListSkeleton rows={1} label="Loading the page" />
        <AnswerSkeleton />
      </div>
    );

  const { chat, item, messages, runs, entities, extractions } = detail;
  const active = runs.filter((r) => ACTIVE.has(r.status));
  const lastAnswer = [...messages].reverse().find((m) => m.kind === 'answer')?.structured ?? null;
  const capped = runs.some((r) => r.status === 'capped') && active.length === 0;
  const runOf = (runId: string | null | undefined) => runs.find((r) => r.id === runId);
  const liveRun = active[0];
  // The newest finished run speaks for the footer row; a live one takes precedence.
  const lastRun = liveRun ?? [...runs].filter((r) => r.finishedAt).at(-1) ?? runs.at(-1);
  const hasAnswer = messages.some((m) => m.role === 'assistant');

  // Hosted run failures carry a reason (ADR 0032); map it to copy that names the fix.
  const fail = (ex: unknown) =>
    setErr(failureCopy(ex instanceof ApiError ? ex.message : String(ex)));
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
  /** Saved list (ADR 0031): keep a thing or a task from this page, then confirm with a toast. */
  const saved = () => toast('Saved to your list', 'Find it under Library, To do.');
  async function saveThing(e: Entity) {
    try {
      await api.createTodo({
        kind: e.kind,
        title: e.name,
        url: e.url ?? null,
        attributes: e.attributes,
        chatId: id,
      });
      saved();
    } catch (ex) {
      fail(ex);
    }
  }
  async function saveTask(title: string, note: string | null) {
    try {
      await api.createTodo({ kind: 'task', title, note, chatId: id });
      setSheet(null);
      saved();
    } catch (ex) {
      fail(ex);
    }
  }
  const actions: (MenuAction | 'separator')[] = [
    { label: 'Tags…', icon: 'tag', onSelect: () => setSheet('tags') },
    { label: 'Collections…', icon: 'folder', onSelect: () => setSheet('collections') },
    { label: 'Add a task…', icon: 'check-square', onSelect: () => setSheet('task') },
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
        source={<SourceLine chat={chat} item={item} at={chat.createdAt} />}
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

      <div className="turns">
        {messages
          .filter(
            (m) =>
              m.role !== 'user' ||
              !isBareShare(m.content, [item.canonicalUrl, item.sourceUrl, chat.sourceUrl]),
          )
          .map((m) => (
            <Turn msg={m} key={m.id} onSaveTask={(t) => void saveTask(t, null)} />
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

      {lastAnswer && lastAnswer.claims.length > 0 && <Claims claims={lastAnswer.claims} />}
      {lastAnswer && <SourcesReport claims={lastAnswer.claims} />}

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

      <button
        type="button"
        className="m-detail"
        onClick={() => setSheet('detail')}
        aria-label="Open this page's detail: things, sources and the run log"
      >
        <span>{entities.length > 0 ? `${entities.length} things` : 'No things'}</span>
        {lastAnswer && <span>{lastAnswer.claims.length} claims</span>}
        {lastRun && <span>{runFooter(lastRun)}</span>}
        <Icon name="chevron-down" size={14} className="m-detail-chev" />
      </button>

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
      <Sheet
        open={sheet === 'task'}
        onOpenChange={(o) => setSheet(o ? 'task' : null)}
        title="Add a task"
        description="Something to do about this page. It lands on your list with a link back here."
      >
        <TaskForm onSave={saveTask} />
      </Sheet>
      <Sheet
        open={sheet === 'detail'}
        onOpenChange={(o) => setSheet(o ? 'detail' : null)}
        title="This page's detail"
        description="What the brain pulled out of this one, the text it read, and every run it took to answer."
      >
        <AnswerTabs
          entities={entities}
          extractions={extractions}
          runs={runs}
          events={events}
          onOpenRun={loadEvents}
          onCancel={(runId) => void api.cancelRun(runId).then(load).catch(fail)}
          onSave={(e) => void saveThing(e)}
        />
      </Sheet>
    </div>
  );
}
