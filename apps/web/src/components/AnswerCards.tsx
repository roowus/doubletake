import type { Answer, Entity } from '@doubletake/shared';

export function EntityCards({ entities }: { entities: Entity[] }) {
  if (entities.length === 0) return null;
  return (
    <div className="stack">
      <div className="small muted">Extracted</div>
      <div className="cards">
        {entities.map((e) => (
          <div className="ecard" key={`${e.kind}:${e.name}`}>
            <div className="kind">{e.kind}</div>
            <div className="name">
              {e.url ? (
                <a href={e.url} target="_blank" rel="noopener noreferrer">
                  {e.name}
                </a>
              ) : (
                e.name
              )}
            </div>
            {Object.entries(e.attributes).map(([k, v]) => (
              <div className="small muted" key={k}>
                {k}: {String(v)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Claims({ claims }: { claims: Answer['claims'] }) {
  if (claims.length === 0) return null;
  return (
    <div className="stack tight">
      <div className="small muted">Claims</div>
      <div className="claims">
        {claims.map((c) => (
          <div className="claim" key={c.claim}>
            <span className={`verdict ${c.verdict}`}>{c.verdict}</span>
            <div>
              {c.claim}
              {c.sources.length > 0 && (
                <div className="refs small">
                  {c.sources.map((s, i) => (
                    <a key={s} href={s} target="_blank" rel="noopener noreferrer">
                      [{i + 1}]
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Recommendations({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="stack tight">
      <div className="small muted">Recommendations</div>
      <ul className="md">
        {items.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
