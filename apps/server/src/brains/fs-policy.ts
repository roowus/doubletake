import fs from 'node:fs';
import path from 'node:path';
import type { ToolPolicy } from '@doubletake/brain-sdk';
import { minimatch } from 'minimatch';

export type FsDecision = { ok: true; realPath: string } | { ok: false; reason: string };

function realpathLenient(p: string): string {
  // Resolve the deepest existing ancestor so symlinked parents cannot escape a root,
  // then re-append the non-existent tail (needed for writes of new files).
  let cur = path.resolve(p);
  const tail: string[] = [];
  while (!fs.existsSync(cur)) {
    tail.unshift(path.basename(cur));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const real = fs.realpathSync.native(cur);
  return path.join(real, ...tail);
}

function under(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, process.env.HOME ?? '');
}

function denied(realPath: string, deny: string[]): string | null {
  for (const pattern of deny) {
    const expanded = expandHome(pattern);
    if (expanded.includes('*')) {
      // Glob rule: match against the real absolute path; `**/x` matches at any depth.
      if (minimatch(realPath, expanded, { dot: true, matchBase: !expanded.includes('/') }))
        return pattern;
    } else {
      // Directory/file rule: resolve symlinks on the rule too, so /var vs /private/var agree.
      let abs: string;
      try {
        abs = realpathLenient(expanded);
      } catch {
        abs = path.resolve(expanded);
      }
      if (under(abs, realPath)) return pattern;
    }
  }
  return null;
}

/** May the brain read this path? `~` is expanded and symlinks resolved before roots/deny are checked. */
export function checkRead(p: string, policy: ToolPolicy): FsDecision {
  let realPath: string;
  try {
    realPath = realpathLenient(expandHome(p));
  } catch (e) {
    return { ok: false, reason: `cannot resolve path: ${(e as Error).message}` };
  }
  const roots = policy.readRoots.map((r) => realpathLenient(r));
  if (!roots.some((r) => under(r, realPath))) {
    return { ok: false, reason: 'outside the readable roots' };
  }
  const hit = denied(realPath, policy.readDeny);
  if (hit) return { ok: false, reason: `matches deny rule ${hit}` };
  return { ok: true, realPath };
}

/** May the brain write this path? Only inside writeRoot; deny rules still apply. */
export function checkWrite(p: string, policy: ToolPolicy): FsDecision {
  if (!policy.writeRoot) return { ok: false, reason: 'writing is disabled in this mode' };
  let realPath: string;
  try {
    realPath = realpathLenient(expandHome(p));
  } catch (e) {
    return { ok: false, reason: `cannot resolve path: ${(e as Error).message}` };
  }
  const root = realpathLenient(policy.writeRoot);
  if (!under(root, realPath)) return { ok: false, reason: 'outside the notes folder' };
  const hit = denied(realPath, policy.readDeny);
  if (hit) return { ok: false, reason: `matches deny rule ${hit}` };
  return { ok: true, realPath };
}

export function readFileChecked(
  p: string,
  policy: ToolPolicy,
): { ok: true; content: string; truncated: boolean } | { ok: false; reason: string } {
  const d = checkRead(p, policy);
  if (!d.ok) return d;
  let st: fs.Stats;
  try {
    st = fs.statSync(d.realPath);
  } catch {
    return { ok: false, reason: 'no such file' };
  }
  if (!st.isFile()) return { ok: false, reason: 'not a regular file' };
  const fd = fs.openSync(d.realPath, 'r');
  try {
    const cap = policy.maxReadBytes;
    const buf = Buffer.alloc(Math.min(cap, st.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return { ok: true, content: buf.toString('utf8'), truncated: st.size > cap };
  } finally {
    fs.closeSync(fd);
  }
}

export function listDirChecked(
  p: string,
  policy: ToolPolicy,
):
  | { ok: true; entries: { name: string; kind: 'file' | 'dir' | 'other' }[] }
  | { ok: false; reason: string } {
  const d = checkRead(p, policy);
  if (!d.ok) return d;
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(d.realPath, { withFileTypes: true });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const entries = ents
    .filter((e) => checkRead(path.join(d.realPath, e.name), policy).ok)
    .slice(0, 500)
    .map((e) => ({
      name: e.name,
      kind: e.isDirectory()
        ? ('dir' as const)
        : e.isFile()
          ? ('file' as const)
          : ('other' as const),
    }));
  return { ok: true, entries };
}

export function writeFileChecked(
  p: string,
  content: string,
  policy: ToolPolicy,
): { ok: true; realPath: string } | { ok: false; reason: string } {
  const d = checkWrite(p, policy);
  if (!d.ok) return d;
  if (Buffer.byteLength(content) > 5 * 1024 * 1024)
    return { ok: false, reason: 'content exceeds 5 MB' };
  fs.mkdirSync(path.dirname(d.realPath), { recursive: true });
  fs.writeFileSync(d.realPath, content);
  return { ok: true, realPath: d.realPath };
}
