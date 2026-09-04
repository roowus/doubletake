import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrainSet } from '../src/brains/registry.js';
import { ingest } from '../src/ingest/index.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

const env = tempEnv('dt-brainset-');
const main = new FakeBrain();
const deep = new FakeBrain('fake-deep');
deep.sessionId = 'sess-deep-1';
const brains = new BrainSet(main, { deep: { adapter: 'fake-deep', model: 'big-model' } }, [deep]);
const worker = new QueueWorker(env.repo, brains, env.cfg);
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  env.cleanup();
});

describe('BrainSet', () => {
  it('resolves modes, ids and vision', () => {
    expect(brains.all().map((b) => b.id)).toEqual(['fake', 'fake-deep']);
    expect(brains.forMode('quick')).toEqual({ adapter: main, model: null });
    expect(brains.forMode('deep')).toEqual({ adapter: deep, model: 'big-model' });
    expect(brains.get('fake-deep')).toBe(deep);
    expect(brains.get('nope')).toBe(main); // unknown → default
    expect(brains.visionFor(deep)).toBe(main); // neither claims vision → default
    expect(BrainSet.from(main).all()).toEqual([main]);
  });

  it('rejects a mode bound to an unknown adapter', () => {
    expect(() => new BrainSet(main, { quick: { adapter: 'ghost', model: null } })).toThrow(/ghost/);
  });

  it('reports healthchecks with default and mode labels, cached until refresh', async () => {
    const first = await brains.healthchecks();
    expect(first.map((h) => [h.id, h.ok, h.default, h.modes])).toEqual([
      ['fake', true, true, []],
      ['fake-deep', true, false, ['deep']],
    ]);
    deep.healthy = { ok: false, detail: 'binary missing' };
    expect((await brains.healthchecks())[1]?.ok).toBe(true); // cached
    const fresh = await brains.healthchecks(true);
    expect(fresh[1]).toMatchObject({ id: 'fake-deep', ok: false, detail: 'binary missing' });
    deep.healthy = { ok: true };
    await brains.healthchecks(true);
  });

  it('rebinds a run after classification and pins follow-ups to the session adapter', async () => {
    main.classifyReply = '{"mode":"deep","question_type":"compare","needs_comments":false}';
    const phases: Record<string, unknown>[] = [];
    worker.on('run_event', (e) => {
      if (e.type === 'status' && e.payload.phase === 'adapter') phases.push(e.payload);
    });
    const out = ingest(
      { text: 'Compare Widget and Gadget', channel: 'compose', focus: 'whole', modeHint: 'auto' },
      { repo: env.repo, adapterFor: (m) => brains.forMode(m) },
    );
    expect(out.run.adapter).toBe('fake'); // auto → default until classified
    worker.kick();
    await waitFor(() => env.repo.getRun(out.run.id)?.status === 'done');

    const run = env.repo.getRun(out.run.id);
    expect(run?.mode).toBe('deep');
    expect(run?.adapter).toBe('fake-deep');
    expect(run?.model).toBe('big-model');
    expect(phases).toEqual([{ phase: 'adapter', adapter: 'fake-deep', model: 'big-model' }]);
    expect(main.calls.filter((c) => c.kind === 'run')).toHaveLength(0);
    expect(main.calls.filter((c) => c.kind === 'classify')).toHaveLength(1); // classification stays on default
    const researched = deep.calls.find((c) => c.kind === 'run');
    expect(researched?.opts?.model).toBe('big-model');
    expect(env.repo.getChat(out.chat.id)?.brainAdapter).toBe('fake-deep');
    expect(env.repo.getChat(out.chat.id)?.brainSessionId).toBe('sess-deep-1');

    // The follow-up stays on the adapter that owns the session (the item's effective mode is
    // deep, so its model binding still applies).
    env.repo.addMessage({
      chatId: out.chat.id,
      role: 'user',
      kind: 'question',
      content: 'which is cheaper?',
    });
    const fu = env.repo.createRun({
      itemId: out.item.id,
      chatId: out.chat.id,
      kind: 'followup',
      mode: 'quick',
      adapter: 'fake-deep',
      userMessage: 'which is cheaper?',
    });
    worker.kick();
    await waitFor(() => env.repo.getRun(fu.id)?.status === 'done');
    const call = deep.calls.filter((c) => c.kind === 'followUp').at(-1);
    expect(call?.opts?.sessionId).toBe('sess-deep-1');
    expect(call?.opts?.model).toBe('big-model');
    expect(main.calls.filter((c) => c.kind === 'followUp')).toHaveLength(0);
  });
});
