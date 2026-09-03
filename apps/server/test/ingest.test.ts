import { afterAll, describe, expect, it } from 'vitest';
import { classifyItem } from '../src/ingest/classify.js';
import { ingest, titleFromText, titleFromUrl } from '../src/ingest/index.js';
import { FakeBrain, tempEnv } from './helpers.js';

const env = tempEnv('dt-ingest-');
afterAll(() => env.cleanup());
const deps = { repo: env.repo, adapterId: 'fake' };

describe('ingest', () => {
  it('creates item + chat + queued run from a URL and stores the note as a user message', () => {
    const out = ingest(
      {
        url: 'https://www.youtube.com/shorts/abc123DEF45?feature=share',
        channel: 'compose',
        note: 'is this real?',
        focus: 'whole',
        modeHint: 'auto',
      },
      deps,
    );
    expect(out.deduplicated).toBe(false);
    expect(out.item.platform).toBe('youtube');
    expect(out.item.canonicalUrl).toBe('https://www.youtube.com/shorts/abc123DEF45');
    expect(out.item.title).toBe('YouTube Short');
    expect(out.run.status).toBe('queued');
    expect(out.run.kind).toBe('research');
    const msgs = env.repo.listMessages(out.chat.id);
    expect(msgs.map((m) => [m.role, m.kind, m.content])).toEqual([
      ['user', 'question', 'is this real?'],
    ]);
  });

  it('pulls the URL out of shared free text', () => {
    const out = ingest(
      {
        text: 'Check this out https://x.com/someone/status/1234567890 so cool',
        channel: 'android_share',
        focus: 'whole',
        modeHint: 'auto',
      },
      deps,
    );
    expect(out.item.platform).toBe('x');
    expect(out.item.canonicalUrl).toBe('https://x.com/someone/status/1234567890');
  });

  it('text without a URL becomes a text item titled from its first line', () => {
    const out = ingest(
      {
        text: 'Remember to look up sourdough hydration\nmore detail',
        channel: 'compose',
        focus: 'whole',
        modeHint: 'quick',
      },
      deps,
    );
    expect(out.item.platform).toBe('text');
    expect(out.item.title).toBe('Remember to look up sourdough hydration');
    expect(out.run.mode).toBe('quick');
  });

  it('re-sharing the same canonical URL within 24h re-runs on the existing chat', () => {
    const a = ingest(
      {
        url: 'https://www.tiktok.com/@u/video/999?lang=en',
        channel: 'compose',
        focus: 'whole',
        modeHint: 'auto',
      },
      deps,
    );
    const b = ingest(
      { url: 'https://vm.tiktok.com/x/', channel: 'compose', focus: 'whole', modeHint: 'auto' },
      deps,
    );
    expect(b.deduplicated).toBe(false); // short link not resolvable offline → distinct canonical
    const c = ingest(
      {
        url: 'https://www.tiktok.com/@u/video/999',
        channel: 'android_share',
        note: 'compare with other brands',
        focus: 'whole',
        modeHint: 'deep',
      },
      deps,
    );
    expect(c.deduplicated).toBe(true);
    expect(c.chat.id).toBe(a.chat.id);
    expect(c.run.mode).toBe('deep');
    expect(env.repo.listRuns(a.chat.id)).toHaveLength(2);
  });

  it('rejects non-http URLs', () => {
    expect(() =>
      ingest(
        { url: 'ftp://example.com/x', channel: 'compose', focus: 'whole', modeHint: 'auto' },
        deps,
      ),
    ).toThrow(/unsupported/);
  });

  it('title helpers', () => {
    expect(titleFromUrl('https://blog.example.org/post', 'web')).toBe('blog.example.org');
    expect(titleFromText(`${'x'.repeat(100)}\nsecond`)).toMatch(/^x{77}…$/);
  });
});

describe('classifyItem', () => {
  const base = { title: 't', platform: 'web', focus: 'whole', preview: '' };
  it('forced mode wins over keywords and classifier', async () => {
    const brain = new FakeBrain();
    brain.classifyReply = '{"mode":"deep","question_type":"compare","needs_comments":true}';
    const c = await classifyItem(
      { ...base, note: 'quick: deep dive please', forcedMode: 'quick' },
      brain,
    );
    expect(c.mode).toBe('quick');
    expect(c.source).toBe('forced');
    expect(c.question_type).toBe('compare'); // question type still comes from the classifier
  });
  it('keywords beat the classifier for mode', async () => {
    const brain = new FakeBrain();
    brain.classifyReply = '{"mode":"deep","question_type":"is_it_true","needs_comments":false}';
    const c = await classifyItem(
      { ...base, note: 'is this true? quick check', forcedMode: null },
      brain,
    );
    expect(c.mode).toBe('quick');
    expect(c.source).toBe('keywords');
  });
  it('falls back to defaults when the classifier returns garbage or is absent', async () => {
    const brain = new FakeBrain();
    brain.classifyReply = 'I cannot help with that';
    const c = await classifyItem({ ...base, note: null, forcedMode: null }, brain);
    expect(c).toMatchObject({ mode: 'standard', question_type: 'what_is_this', source: 'default' });
    const d = await classifyItem(
      { ...base, note: null, focus: 'comments', forcedMode: null },
      null,
    );
    expect(d.question_type).toBe('explain_comments');
    expect(d.needs_comments).toBe(true);
  });
});
