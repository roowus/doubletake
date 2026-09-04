/** Turn free text into a safe FTS5 query: quoted terms, prefix match, no operators. */
export function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replaceAll('"', '')}"*`)
    .join(' ');
}
