import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolPolicy } from '@doubletake/brain-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkRead,
  checkWrite,
  listDirChecked,
  readFileChecked,
  writeFileChecked,
} from '../src/brains/fs-policy.js';

let home: string;
let policy: ToolPolicy;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-fs-'));
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), 'secret');
  fs.mkdirSync(path.join(home, 'docs'));
  fs.writeFileSync(path.join(home, 'docs', 'notes.md'), '# hello');
  fs.writeFileSync(path.join(home, 'docs', '.env.local'), 'KEY=1');
  fs.writeFileSync(path.join(home, 'docs', 'cert.pem'), 'pem');
  fs.mkdirSync(path.join(home, 'Doubletake'));
  fs.symlinkSync(path.join(home, '.ssh', 'id_ed25519'), path.join(home, 'docs', 'sneaky'));
  fs.symlinkSync('/etc', path.join(home, 'docs', 'etc-link'));
  fs.writeFileSync(path.join(home, 'docs', 'big.txt'), 'x'.repeat(5000));
  policy = {
    webSearch: true,
    maxSearches: 3,
    webFetch: true,
    maxFetches: 3,
    readRoots: [home],
    readDeny: [path.join(home, '.ssh'), '**/.env*', '**/*.pem', '**/node_modules'],
    maxReadBytes: 1024,
    writeRoot: path.join(home, 'Doubletake'),
  };
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('fs policy', () => {
  it('allows ordinary files under the root', () => {
    expect(checkRead(path.join(home, 'docs', 'notes.md'), policy).ok).toBe(true);
  });
  it('denies denylisted directories', () => {
    expect(checkRead(path.join(home, '.ssh', 'id_ed25519'), policy).ok).toBe(false);
  });
  it('denies glob patterns (.env*, *.pem)', () => {
    expect(checkRead(path.join(home, 'docs', '.env.local'), policy).ok).toBe(false);
    expect(checkRead(path.join(home, 'docs', 'cert.pem'), policy).ok).toBe(false);
  });
  it('resolves symlinks before checking', () => {
    expect(checkRead(path.join(home, 'docs', 'sneaky'), policy).ok).toBe(false);
    expect(checkRead(path.join(home, 'docs', 'etc-link', 'hosts'), policy).ok).toBe(false);
  });
  it('denies paths outside the roots and traversal', () => {
    expect(checkRead('/etc/passwd', policy).ok).toBe(false);
    expect(checkRead(path.join(home, 'docs', '..', '..', 'x'), policy).ok).toBe(false);
  });
  it('caps read size', () => {
    const r = readFileChecked(path.join(home, 'docs', 'big.txt'), policy);
    expect(r.ok && r.truncated && r.content.length === 1024).toBe(true);
  });
  it('hides denied entries from listings', () => {
    const r = listDirChecked(path.join(home, 'docs'), policy);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.entries.map((e) => e.name);
      expect(names).toContain('notes.md');
      expect(names).not.toContain('.env.local');
      expect(names).not.toContain('sneaky');
    }
  });
  it('writes only under the notes folder', () => {
    expect(checkWrite(path.join(home, 'docs', 'x.md'), policy).ok).toBe(false);
    const w = writeFileChecked(path.join(home, 'Doubletake', 'a', 'b.md'), 'hi', policy);
    expect(w.ok).toBe(true);
    expect(fs.readFileSync(path.join(home, 'Doubletake', 'a', 'b.md'), 'utf8')).toBe('hi');
    expect(checkWrite(path.join(home, 'Doubletake', '..', 'docs', 'x.md'), policy).ok).toBe(false);
  });
  it('refuses writes when writeRoot is null', () => {
    expect(
      checkWrite(path.join(home, 'Doubletake', 'x.md'), { ...policy, writeRoot: null }).ok,
    ).toBe(false);
  });
});
