import type { Answer as AnswerT, MessageDto, RunDto } from '@doubletake/shared';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { hostOf } from './SourceLine';

/** Run meta set in mono small caps: mode, brain (when pinned), duration, cost. */
export function runMeta(run: RunDto): string[] {
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

/** "Sep 7" for the source line; the year only when it is not this one. */
export function dateline(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * The owner's own words: a quiet dated one-liner and the text. Used for the note that came
 * with the share and for every follow-up question. The shared URL itself is never repeated
 * here; the source line above the title already names it.
 */
export function AskLine({ text, at }: { text: string; at: string }) {
  return (
    <div className="turn you">
      <div className="turn-label">
        <span>You asked</span>
        <time dateTime={at}>{dateline(at)}</time>
      </div>
      <p className="you-text">{text}</p>
    </div>
  );
}

/** True for a message that is nothing but the shared link, which the source line covers. */
export function isBareShare(content: string, urls: (string | null | undefined)[]): boolean {
  const text = content.trim();
  if (!/^https?:\/\/\S+$/.test(text)) return false;
  return urls.some((u) => !!u && u.trim() === text);
}

/**
 * One turn of the page. The owner's lines are a quiet one-liner ("You asked", a date, the
 * text); the brain's answers are the page itself: full-width prose, no label, no bubble, no
 * meta above it. The run's meta lives in the footer row now (ADR 0034).
 */
export function Turn({
  msg,
  onSaveTask,
}: {
  msg: MessageDto;
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
  if (msg.role === 'user') return <AskLine text={msg.content} at={msg.createdAt} />;
  return (
    <article className="turn answer">
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

const VERDICT_LABEL: Record<string, string> = {
  true: 'supported',
  mixed: 'contested',
  false: 'refuted',
  unverified: 'unverified',
};

/** "1 supported · 1 contested · 1 refuted", in claim order, skipping empty counts. */
function tally(claims: AnswerT['claims']): string {
  const counts = new Map<string, number>();
  for (const c of claims) counts.set(c.verdict, (counts.get(c.verdict) ?? 0) + 1);
  return [...counts.entries()].map(([v, n]) => `${n} ${VERDICT_LABEL[v] ?? v}`).join(' · ');
}

function sourceHosts(urls: string[]): string {
  const hosts = [...new Set(urls.map((u) => hostOf(u) ?? u))];
  return hosts.length > 0 ? hosts.join(', ') : 'no source found';
}

/** The part of a URL after the host, so the sources report does not print the host twice. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.replace(/\/$/, '') || '/';
  } catch {
    return url;
  }
}

/**
 * The claims report: what backs the answer, printed under it. Each row is a claim, the verdict
 * the brain reached, where it looked, and (when the verdict is not plainly true) the reason it
 * gives. Rows carry `id="claim-n"` so an evidence mark in the prose can jump to them.
 */
export function Claims({ claims }: { claims: AnswerT['claims'] }) {
  if (claims.length === 0)
    return (
      <p className="muted small empty-note">
        This answer made no checkable claims, so there was nothing to verify.
      </p>
    );
  return (
    <div className="report">
      <div className="report-h">
        <span>Claims</span>
        <span className="report-c">{tally(claims)}</span>
      </div>
      <ol className="claims">
        {claims.map((c, i) => (
          <li className="claim" key={c.claim} id={`claim-${i + 1}`}>
            <span className="claim-n">{i + 1}</span>
            <div className="claim-body">
              <p className="claim-text">{c.claim}</p>
              <div className="claim-meta">
                <span className={`verdict ${c.verdict}`} title={`Verdict: ${c.verdict}`}>
                  {c.verdict}
                </span>
                <span className="claim-src">{sourceHosts(c.sources)}</span>
              </div>
              {c.reason && <p className="claim-reason">{c.reason}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The sources report: the distinct URLs the claims cite, each with the claim numbers that
 * point at it. The host leads and the path follows in mono, so the same host is not printed
 * twice. Answers without citations say so rather than rendering an empty list.
 */
export function SourcesReport({ claims }: { claims: AnswerT['claims'] }) {
  const byUrl = new Map<string, number[]>();
  claims.forEach((c, i) => {
    for (const url of c.sources) byUrl.set(url, [...(byUrl.get(url) ?? []), i + 1]);
  });
  const rows = [...byUrl.entries()];
  return (
    <div className="report">
      <div className="report-h">
        <span>Sources</span>
        <span>{rows.length > 0 ? `${rows.length} cited` : ''}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted small empty-note">No sources were cited for this answer.</p>
      ) : (
        <ul className="srclist">
          {rows.map(([url, ns]) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <span className="src-host">{hostOf(url) ?? url}</span>
                <span className="src-url">{pathOf(url)}</span>
              </a>
              <span className="src-n">{ns.map((n) => `[${n}]`).join(' ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
