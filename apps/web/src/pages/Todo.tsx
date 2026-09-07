import type { TodoDto, TodoKind } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { Confirm } from '../components/Confirm';
import { Icon, type IconName } from '../components/Icon';
import { ListSkeleton } from '../components/Skeleton';
import { TaskForm } from '../components/TaskForm';
import { ago } from '../format';
import { useLive } from '../live';
import { Link } from '../router';
import { mapsUrl } from './Entities';

/** Glyph per saved kind; tasks get the check square, things keep their Library icon. */
const KIND_ICON: Record<TodoKind, IconName> = {
  task: 'check-square',
  place: 'map-pin',
  recipe: 'utensils',
  product: 'shopping-bag',
  tool: 'wrench',
  tip: 'lightbulb',
  media: 'film',
  person: 'user',
  event: 'calendar',
  other: 'bookmark',
};

/** The attribute keys worth a glance under a saved thing's title. */
const SHOWN_ATTRS = ['city', 'country', 'address', 'price', 'brand', 'cuisine', 'time', 'install'];

function attrLine(t: TodoDto): string {
  return SHOWN_ATTRS.map((k) => t.attributes[k])
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map(String)
    .slice(0, 3)
    .join(' · ');
}

/**
 * The saved list (ADR 0031): what the owner chose to keep from answers, places to visit, tools
 * to try, free-form tasks. Open entries first, ticked ones under a fold. Every entry links back
 * to the chat it came from.
 */
export function Todo() {
  const [todos, setTodos] = useState<TodoDto[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<TodoDto | null>(null);

  const load = () => {
    api
      .todos('all')
      .then((t) => {
        setTodos(t);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  };
  useEffect(load, []);
  useLive((e) => {
    if (e.kind === 'chat_updated') load();
  });
  const fail = (ex: unknown) => setErr(ex instanceof ApiError ? ex.message : String(ex));

  async function toggle(t: TodoDto) {
    // Optimistic: flip locally, then reconcile with the server's answer.
    setTodos((list) =>
      (list ?? []).map((x) =>
        x.id === t.id ? { ...x, doneAt: t.doneAt ? null : new Date().toISOString() } : x,
      ),
    );
    try {
      await api.updateTodo(t.id, { done: !t.doneAt });
      load();
    } catch (ex) {
      fail(ex);
      load();
    }
  }
  async function remove(t: TodoDto) {
    try {
      await api.deleteTodo(t.id);
      load();
    } catch (ex) {
      fail(ex);
    }
  }

  const open = (todos ?? []).filter((t) => !t.doneAt);
  const done = (todos ?? []).filter((t) => t.doneAt);

  const row = (t: TodoDto) => {
    const maps =
      t.kind === 'place'
        ? mapsUrl({ kind: 'place', name: t.title, attributes: t.attributes })
        : null;
    const attrs = attrLine(t);
    return (
      <li key={t.id} className={`todo${t.doneAt ? ' done' : ''}`}>
        <button
          type="button"
          className="todo-check"
          aria-pressed={!!t.doneAt}
          aria-label={t.doneAt ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
          onClick={() => void toggle(t)}
        >
          <Icon name={t.doneAt ? 'check-square' : 'square'} size={20} />
        </button>
        <div className="todo-body">
          <div className="todo-title">
            <Icon name={KIND_ICON[t.kind]} size={14} className="todo-kind" />
            {t.url ? (
              <a href={t.url} target="_blank" rel="noopener noreferrer">
                {t.title}
                <Icon name="external-link" size={12} />
              </a>
            ) : (
              <span>{t.title}</span>
            )}
          </div>
          {(t.note || attrs) && (
            <div className="todo-meta">
              {t.note && <span className="todo-note">{t.note}</span>}
              {attrs && <span>{attrs}</span>}
            </div>
          )}
          <div className="todo-foot">
            {t.chatId && (
              <Link to={`/chat/${t.chatId}`} className="truncate">
                {t.chatTitle || 'Open the answer'}
              </Link>
            )}
            {maps && (
              <a href={maps} target="_blank" rel="noopener noreferrer">
                Map
              </a>
            )}
            <time dateTime={t.doneAt ?? t.createdAt}>
              {t.doneAt ? `done ${ago(t.doneAt)}` : ago(t.createdAt)}
            </time>
          </div>
        </div>
        <button
          type="button"
          className="ghost icon small"
          aria-label={`Remove "${t.title}" from the list`}
          onClick={() => setToDelete(t)}
        >
          <Icon name="trash" size={16} />
        </button>
      </li>
    );
  };

  return (
    <div className="page stack loose todo-page">
      <div className="page-head">
        <Link to="/library" className="icon-link" aria-label="Back to Library">
          <Icon name="arrow-left" />
        </Link>
        <h1>
          To do
          {todos && open.length > 0 && <span className="count-badge">{open.length}</span>}
        </h1>
        <button
          type="button"
          className="ghost"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
        >
          <Icon name="plus" size={18} />
          Task
        </button>
      </div>

      {adding && (
        <div className="card">
          <TaskForm
            onSave={async (title, note) => {
              try {
                await api.createTodo({ kind: 'task', title, note });
                setAdding(false);
                load();
              } catch (ex) {
                fail(ex);
              }
            }}
          />
        </div>
      )}

      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}

      {!todos ? (
        <ListSkeleton rows={4} label="Loading your list" />
      ) : open.length === 0 && done.length === 0 ? (
        <p className="muted empty-note">
          Nothing saved yet. On any answer, use the bookmark next to a place, product or tool, or
          add a task from the page menu.
        </p>
      ) : (
        <>
          {open.length === 0 ? (
            <p className="muted empty-note">All done. Nice.</p>
          ) : (
            <ul className="todos">{open.map(row)}</ul>
          )}
          {done.length > 0 && (
            <section className="stack tight">
              <button
                type="button"
                className="ghost fold"
                aria-expanded={showDone}
                onClick={() => setShowDone((s) => !s)}
              >
                <Icon name={showDone ? 'chevron-down' : 'chevron-right'} size={16} />
                Done
                <span className="count-badge">{done.length}</span>
              </button>
              {showDone && <ul className="todos">{done.map(row)}</ul>}
            </section>
          )}
        </>
      )}

      <Confirm
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={toDelete ? `Remove "${toDelete.title}"?` : ''}
        body="It leaves your list. The answer it came from is not touched."
        action="Remove"
        onConfirm={() => {
          if (toDelete) void remove(toDelete);
          setToDelete(null);
        }}
      />
    </div>
  );
}
