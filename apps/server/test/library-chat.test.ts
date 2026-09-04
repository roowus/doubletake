import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { ingest } from '../src/ingest/index.js';
import { LIBRARY_TOOL, libraryContext } from '../src/library/ask.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

const env = tempEnv('dt-library-');
const brain = new FakeBrain();
const worker = new QueueWorker(env.repo, brain, env.cfg);
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  env.cleanup();
});
const deps = { repo: env.repo, adapterId: brain.id };

async function answered(text: string, note: string, answer: string) {
  brain.nextResult = { text: answer };
  const out = ingest({ text, note, channel: 'compose', focus: 'whole', modeHint: 'quick' }, deps);
  worker.kick();
  await waitFor(() => env.repo.getRun(out.run.id)?.status === 'done');
  brain.nextResult = {};
  return out;
}

describe('cross-library chat (ADR 0021)', () => {
  it('retrieves matching past chats as labelled untrusted blocks and answers from them', async () => {
    const wax = await answered(
      'Swix LF7 vs Toko performance wax for cold snow',
      'ski wax question',
      'Swix LF7 is the better cold-snow wax; Toko is fine above -5C.',
    );
    await answered('Best sourdough starter schedule', 'baking', 'Feed twice a day at 78F.');

    // Retrieval alone: the wax chat matches, the bread chat does not.
    const ctx = libraryContext(env.repo, 'what did I save about ski wax');
    expect(ctx.hits.map((h) => h.chatId)).toEqual([wax.chat.id]);
    expect(ctx.blocks[0]).toMatchObject({ source: 'library', kind: 'page_text' });
    expect(ctx.blocks[0]?.label).toContain(`/chat/${wax.chat.id}`);
    expect(ctx.blocks[0]?.content).toContain('Swix LF7 is the better cold-snow wax');
    expect(ctx.blocks[0]?.content).toContain('Note: ski wax question');
    expect(ctx.hints).toEqual([`${wax.item.title}: /chat/${wax.chat.id}`]);

    // Full pipeline through the library channel.
    brain.calls.length = 0;
    const events: string[] = [];
    worker.on('run_event', (e) => events.push(`${e.type}:${String(e.payload.phase ?? '')}`));
    const ask = ingest(
      {
        text: 'what did I save about ski wax?',
        channel: 'library',
        focus: 'whole',
        modeHint: 'auto',
      },
      deps,
    );
    expect(ask.item.channel).toBe('library');
    expect(ask.item.platform).toBe('text');
    expect(ask.item.note).toBe('what did I save about ski wax?');
    expect(ask.item.title).toBe('what did I save about ski wax?');
    worker.kick();
    await waitFor(() => env.repo.getRun(ask.run.id)?.status === 'done');

    const run = env.repo.getRun(ask.run.id);
    expect(run?.mode).toBe('quick'); // no keyword → quick, no classifier call
    expect(brain.calls.filter((c) => c.kind === 'classify')).toHaveLength(0);
    const call = brain.calls.find((c) => c.kind === 'run');
    expect(call?.brief?.kind).toBe('library');
    expect(call?.brief?.note).toBe('what did I save about ski wax?');
    expect(call?.brief?.untrusted).toHaveLength(1);
    expect(call?.brief?.untrusted[0]).toMatchObject({ source: 'library', kind: 'page_text' });
    expect(call?.brief?.localContextHints[0]).toContain(`/chat/${wax.chat.id}`);
    expect(call?.brief?.outputTemplate).toContain('retrieved chats');
    expect(events).toContain('status:retrieving');
    expect(events).toContain('status:retrieved');

    // The consulted context is stored so Sources shows it and follow-ups reuse it.
    const stored = env.repo.listExtractions(ask.item.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'page_text', tool: LIBRARY_TOOL });
    const msgs = env.repo.listMessages(ask.chat.id);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'what did I save about ski wax?' });
    expect(msgs.at(-1)?.kind).toBe('answer');

    // A later question never retrieves the earlier library question itself.
    const again = libraryContext(env.repo, 'ski wax');
    expect(again.hits.map((h) => h.chatId)).toEqual([wax.chat.id]);
  });

  it('a deep keyword or forced mode overrides the quick default', () => {
    const forced = ingest(
      { text: 'ski wax', channel: 'library', focus: 'whole', modeHint: 'standard' },
      deps,
    );
    expect(forced.run.mode).toBe('standard');
    expect(() =>
      ingest({ text: '   ', channel: 'library', focus: 'whole', modeHint: 'auto' }, deps),
    ).toThrow(/question/);
    for (const o of [forced]) env.repo.updateRun(o.run.id, { status: 'failed' });
  });

  it('POST /api/library/chat starts a library chat and the list marks its channel', async () => {
    const app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'correct horse battery', deviceName: 'test' },
    });
    const token = setup.json().token as string;
    const auth = () => ({ authorization: `Bearer ${token}` });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/library/chat',
      headers: auth(),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST',
      url: '/api/library/chat',
      headers: auth(),
      payload: { question: 'anything about sourdough?' },
    });
    expect(res.statusCode).toBe(202);
    const { chatId, runId } = res.json();
    await waitFor(() => env.repo.getRun(runId)?.status === 'done');
    const list = (await app.inject({ method: 'GET', url: '/api/chats', headers: auth() })).json();
    expect(list.find((c: { id: string }) => c.id === chatId)).toMatchObject({
      channel: 'library',
      platform: 'text',
      title: 'anything about sourdough?',
      status: 'answered',
    });
    await app.close();
  });
});

describe('libraryQuery', () => {
  it('drops question filler, keeps real terms, prefix-matches and ORs them', async () => {
    const { libraryQuery } = await import('../src/library/ask.js');
    expect(libraryQuery('what did I save about ski wax?')).toBe('"ski"* OR "wax"*');
    expect(libraryQuery('Was there anything on that sourdough schedule?')).toBe(
      '"sourdough"* OR "schedule"*',
    );
    expect(libraryQuery('what did I save')).toBe('');
  });
});
