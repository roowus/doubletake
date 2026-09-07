import { Tabs } from '@base-ui/react/tabs';
import type {
  Answer,
  Entity,
  EntityKind,
  ExtractionDto,
  RunDto,
  RunEvent,
} from '@doubletake/shared';
import { useState } from 'react';
import { Claims, runMeta } from './Answer';
import { Icon } from './Icon';
import { RunTimeline } from './RunTimeline';

const KIND_LABEL: Record<EntityKind, string> = {
  place: 'Places',
  recipe: 'Recipes',
  product: 'Products',
  tool: 'Tools',
  tip: 'Tips',
  media: 'Media',
  person: 'People',
  event: 'Events',
  other: 'Other',
};

const SOURCE_LABEL: Record<string, string> = {
  transcript: 'Transcript',
  ocr: 'On-screen text',
  frame_description: 'Frames',
  caption: 'Caption',
  comments: 'Comments',
  thread: 'Thread',
  page_text: 'Page text',
};

function attrText(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(attrText).filter(Boolean).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Entity cards grouped by kind, for the Things tab. */
function Things({ entities }: { entities: Entity[] }) {
  if (entities.length === 0)
    return <p className="muted small empty-note">Nothing was extracted from this one.</p>;
  const groups = new Map<EntityKind, Entity[]>();
  for (const e of entities) groups.set(e.kind, [...(groups.get(e.kind) ?? []), e]);
  return (
    <div className="stack">
      {[...groups.entries()].map(([kind, list]) => (
        <section key={kind} className="stack tight">
          <h3 className="group-title">{KIND_LABEL[kind]}</h3>
          <ul className="things">
            {list.map((e) => {
              const attrs = Object.entries(e.attributes)
                .map(([k, v]) => [k, attrText(v)] as const)
                .filter(([, v]) => v.length > 0)
                .slice(0, 4);
              return (
                <li className="thing" key={`${e.kind}:${e.name}`}>
                  <span className="thing-name">
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noopener noreferrer">
                        {e.name}
                        <Icon name="external-link" size={12} />
                      </a>
                    ) : (
                      e.name
                    )}
                  </span>
                  {attrs.length > 0 && (
                    <span className="thing-attrs">
                      {attrs.map(([k, v]) => (
                        <span key={k}>
                          <span className="k">{k.replace(/_/g, ' ')}</span> {v}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Every extraction the brain saw, one chip per source, flattened to readable text. */
function Sources({ extractions }: { extractions: ExtractionDto[] }) {
  const [active, setActive] = useState<string | null>(null);
  const current = extractions.find((e) => e.id === active) ?? extractions[0];
  if (!current)
    return <p className="muted small empty-note">No transcript, text or comments were pulled.</p>;
  return (
    <div className="stack tight">
      <div className="chips scroll" role="tablist" aria-label="Source">
        {extractions.map((e) => (
          <button
            type="button"
            role="tab"
            key={e.id}
            className={`chip ${e.id === current.id ? 'on' : ''}`}
            aria-selected={e.id === current.id}
            onClick={() => setActive(e.id)}
            title={e.tool ?? undefined}
          >
            {SOURCE_LABEL[e.kind] ?? e.kind}
          </button>
        ))}
      </div>
      <div className="mono-meta">
        <span>{current.tool ?? 'unknown tool'}</span>
        <span>{current.createdAt.slice(0, 16).replace('T', ' ')}</span>
        <span>{current.text.length.toLocaleString()} chars</span>
      </div>
      <pre className="sources-text">{current.text}</pre>
    </div>
  );
}

/** Every run of this chat, newest first, with its live or fetched event timeline. */
function Runs({
  runs,
  events,
  onOpenRun,
  onCancel,
}: {
  runs: RunDto[];
  events: Record<string, RunEvent[]>;
  onOpenRun: (runId: string) => void;
  onCancel: (runId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (runs.length === 0) return <p className="muted small empty-note">No runs yet.</p>;
  const list = [...runs].reverse();
  return (
    <ol className="runs">
      {list.map((r) => {
        const live = ACTIVE.has(r.status);
        const isOpen = open === r.id || live;
        return (
          <li className={`run${live ? ' live' : ''}`} key={r.id}>
            <button
              type="button"
              className="run-row"
              aria-expanded={isOpen}
              onClick={() => {
                const next = open === r.id ? null : r.id;
                setOpen(next);
                if (next && !events[r.id]) onOpenRun(r.id);
              }}
            >
              <span className={`status ${r.status}`}>{r.status}</span>
              <span className="mono-meta grow">
                <span>{r.kind}</span>
                {runMeta(r).map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </span>
              <Icon name="chevron-down" size={16} className="chev" />
            </button>
            {r.error && <div className="run-error small">{r.error}</div>}
            {isOpen && (
              <div className="stack tight">
                <RunTimeline events={events[r.id] ?? []} />
                {live && (
                  <div className="row">
                    <button type="button" className="ghost small" onClick={() => onCancel(r.id)}>
                      <Icon name="x" size={14} />
                      Cancel run
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export const ACTIVE = new Set(['queued', 'extracting', 'classifying', 'researching']);

/**
 * The four panels under the answer: Claims (verdicts and sources), Things (entities by kind),
 * Sources (extractions) and Run (timeline). Base UI Tabs gives the roving tabindex and aria
 * wiring; counts in the tab labels say what is inside before you tap.
 */
export function AnswerTabs({
  claims,
  entities,
  extractions,
  runs,
  events,
  onOpenRun,
  onCancel,
}: {
  claims: Answer['claims'];
  entities: Entity[];
  extractions: ExtractionDto[];
  runs: RunDto[];
  events: Record<string, RunEvent[]>;
  onOpenRun: (runId: string) => void;
  onCancel: (runId: string) => void;
}) {
  const live = runs.some((r) => ACTIVE.has(r.status));
  const [value, setValue] = useState<string>(live ? 'run' : 'claims');
  const tab = (id: string, label: string, n: number) => (
    <Tabs.Tab className="atab" value={id}>
      {label}
      {n > 0 && <span className="n">{n}</span>}
    </Tabs.Tab>
  );
  return (
    <Tabs.Root className="atabs" value={value} onValueChange={(v) => setValue(String(v))}>
      <Tabs.List className="atab-list" aria-label="Answer details">
        {tab('claims', 'Claims', claims.length)}
        {tab('things', 'Things', entities.length)}
        {tab('sources', 'Sources', extractions.length)}
        <Tabs.Tab className={`atab${live ? ' live' : ''}`} value="run">
          Run
          {runs.length > 1 && <span className="n">{runs.length}</span>}
        </Tabs.Tab>
        <Tabs.Indicator className="atab-indicator" />
      </Tabs.List>
      <Tabs.Panel className="apanel" value="claims">
        <Claims claims={claims} />
      </Tabs.Panel>
      <Tabs.Panel className="apanel" value="things">
        <Things entities={entities} />
      </Tabs.Panel>
      <Tabs.Panel className="apanel" value="sources">
        <Sources extractions={extractions} />
      </Tabs.Panel>
      <Tabs.Panel className="apanel" value="run">
        <Runs runs={runs} events={events} onOpenRun={onOpenRun} onCancel={onCancel} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
