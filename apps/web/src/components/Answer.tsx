import type { Answer as AnswerT, MessageDto, RunDto } from '@doubletake/shared';
import { Icon } from './Icon';
import { Markdown } from './Markdown';

/** "Sep 4, 14:02" for the dateline above each turn. */
export function dateline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Run meta set in mono small caps: mode, brain (when pinned), cost, duration. */
export function runMeta(run: RunDto | undefined): string[] {
  if (!run) return [];
  const out: string[] = [run.mode];
  if (run.pinned) out.push(`${run.adapter}${run.model ? `@${run.model}` : ''}`);
  if (run.startedAt && run.finishedAt) {
    const s = Math.round(
      (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
    );
    out.push(s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`);
  }
  if (run.costUsd != null) out.push(`$${run.costUsd.toFixed(3)}`);
  return out;
}

/**
 * One turn of the notebook. The owner's questions and notes are a dated single line in the
 * UI face ("You asked"); the brain's answers are full-width prose in the reading face with
 * the run's meta set in the margin. No bubbles: the page is the answer.
 */
export function Turn({
  msg,
  run,
  onSaveTask,
}: {
  msg: MessageDto;
  run?: RunDto | undefined;
  /** Keep one recommendation as a task on the saved list (ADR 0031). */
  onSaveTask?: ((text: string) => void) | undefined;
}) {
  if (msg.role === 'system')
    return (
      <div className={`turn system${msg.kind === 'error' ? ' error' : ''}`} role="status">
        <Icon name={msg.kind === 'error' ? 'alert' : 'info'} size={14} />
        <span>{msg.content}</span>
      </div>
    );
  if (msg.role === 'user')
    return (
      <div className="turn you">
        <div className="turn-label">
          <span>{msg.kind === 'question' ? 'You wrote' : 'You asked'}</span>
          <time dateTime={msg.createdAt}>{dateline(msg.createdAt)}</time>
        </div>
        <p className="you-text">{msg.content}</p>
      </div>
    );
  const meta = runMeta(run);
  return (
    <article className="turn answer">
      {meta.length > 0 && (
        <div className="turn-label">
          {meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
          <time dateTime={msg.createdAt}>{dateline(msg.createdAt)}</time>
        </div>
      )}
      <div className="prose">
        <Markdown>{msg.content}</Markdown>
        {msg.structured && msg.kind === 'answer' && (
          <Recommendations items={msg.structured.recommendations} onSave={onSaveTask} />
        )}
      </div>
    </article>
  );
}

function Recommendations({
  items,
  onSave,
}: {
  items: string[];
  onSave?: ((text: string) => void) | undefined;
}) {
  if (items.length === 0) return null;
  return (
    <aside className="recs">
      <h3>Recommendations</h3>
      <ul>
        {items.map((r) => (
          <li key={r}>
            <span>{r}</span>
            {onSave && (
              <button
                type="button"
                className="thing-save"
                aria-label="Save this recommendation as a task"
                title="Save as a task"
                onClick={() => onSave(r)}
              >
                <Icon name="bookmark" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Verdict chips for the Claims tab: ✓ true, ~ mixed, ✗ false, ? unverified, with sources. */
export function Claims({ claims }: { claims: AnswerT['claims'] }) {
  if (claims.length === 0)
    return <p className="muted small empty-note">This answer made no checkable claims.</p>;
  return (
    <ol className="claims">
      {claims.map((c) => (
        <li className="claim" key={c.claim}>
          <span className={`verdict ${c.verdict}`} title={`Verdict: ${c.verdict}`}>
            <Icon
              size={12}
              name={c.verdict === 'true' ? 'check' : c.verdict === 'false' ? 'x' : 'info'}
            />
            {c.verdict}
          </span>
          <div className="claim-body">
            <p>{c.claim}</p>
            <div className="claim-meta">
              <span className="confidence" title={`confidence ${Math.round(c.confidence * 100)}%`}>
                <span className="bar" data-pct={Math.round(c.confidence * 10) * 10} />
              </span>
              {c.sources.map((s, i) => (
                <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="ref">
                  [{i + 1}]
                </a>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Skeleton lines while a run is producing its first answer. */
export function AnswerSkeleton() {
  return (
    <div className="prose skeleton" aria-hidden="true">
      <span className="sk w80" />
      <span className="sk w100" />
      <span className="sk w95" />
      <span className="sk w60" />
    </div>
  );
}
