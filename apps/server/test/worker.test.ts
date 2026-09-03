import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingest } from '../src/ingest/index.js';
import { escalationIsMeaningful, QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

const env = tempEnv('dt-worker-');
const brain = new FakeBrain();
const worker = new QueueWorker(env.repo, brain, env.cfg);
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  env.cleanup();
});

const deps = { repo: env.repo, adapterId: brain.id };

describe('QueueWorker', () => {
  it('runs a text item end to end: classify → research → message, entities, tags, FTS, export, cost', async () => {
    const events: string[] = [];
    worker.on('run_event', (e) => events.push(`${e.type}:${String(e.payload.phase ?? '')}`));
    const out = ingest(
      {
        text: 'What is a Widget?',
        note: 'is this legit',
        channel: 'compose',
        focus: 'whole',
        modeHint: 'auto',
      },
      deps,
    );
    worker.kick();
    await waitFor(() => env.repo.getRun(out.run.id)?.status === 'done');

    const run = env.repo.getRun(out.run.id);
    expect(run?.mode).toBe('standard'); // 'legit' keyword → standard
    expect(run?.costUsd).toBeCloseTo(0.02);
    const item = env.repo.getItem(out.item.id);
    expect(item?.status).toBe('answered');
    expect(item?.category).toBe('tech');
    expect(item?.questionType).toBe('what_is_this');
    const chat = env.repo.getChat(out.chat.id);
    expect(chat?.unreadCount).toBe(1);
    expect(chat?.brainSessionId).toBe('sess-fake-1');
    const msgs = env.repo.listMessages(out.chat.id);
    expect(msgs.at(-1)?.content).toBe('Researched answer.');
    expect(msgs.at(-1)?.kind).toBe('answer');
    expect(env.repo.listEntities(out.item.id).map((e) => e.name)).toEqual(['Widget']);
    expect(env.repo.listTags(out.item.id).sort()).toEqual(['tools', 'widgets']);
    expect(env.repo.searchFts('"widget"*')).toContain(out.item.id);
    expect(env.repo.spentToday()).toBeCloseTo(0.02);
    expect(events).toContain('status:classifying');
    expect(events).toContain('done:');

    // Brief carried the shared text as untrusted and the owner note.
    const call = brain.calls.find((c) => c.kind === 'run');
    expect(call?.brief?.untrusted.map((b) => b.kind)).toEqual(['shared_text']);
    expect(call?.brief?.note).toBe('is this legit');
    expect(call?.opts?.tools.readRoots).toEqual(env.cfg.readRoots); // standard mode reads files
    expect(call?.opts?.tools.writeRoot).toBeNull(); // but does not write

    // Markdown export landed in the notes dir.
    const year = String(new Date().getFullYear());
    const files = fs.readdirSync(path.join(env.cfg.notesDir, year));
    expect(files).toHaveLength(1);
    const md = fs.readFileSync(path.join(env.cfg.notesDir, year, files[0] ?? ''), 'utf8');
    expect(md).toContain(`doubletake_id: ${out.item.id}`);
    expect(md).toContain('Researched answer.');
    expect(md).toContain('**Widget** (tool)');
  });

  it('follow-up resumes the session and appends a followup message', async () => {
    const chatRow = env.repo.listChats()[0];
    if (!chatRow) throw new Error('no chat');
    env.repo.addMessage({
      chatId: chatRow.chat.id,
      role: 'user',
      kind: 'question',
      content: 'cheaper alternatives?',
    });
    const run = env.repo.createRun({
      itemId: chatRow.item.id,
      chatId: chatRow.chat.id,
      kind: 'followup',
      mode: 'standard',
      adapter: brain.id,
      userMessage: 'cheaper alternatives?',
    });
    worker.kick();
    await waitFor(() => env.repo.getRun(run.id)?.status === 'done');
    const call = brain.calls.filter((c) => c.kind === 'followUp').at(-1);
    expect(call?.chat?.sessionId).toBe('sess-fake-1');
    expect(call?.opts?.maxTurns).toBe(3);
    expect(call?.opts?.sessionId).toBe('sess-fake-1');
    const last = env.repo.listMessages(chatRow.chat.id).at(-1);
    expect(last?.kind).toBe('followup');
    expect(last?.content).toContain('cheaper alternatives?');
  });

  it('a brain error marks the run failed and posts an error message', async () => {
    brain.nextResult = { stopReason: 'error', error: 'boom' };
    const out = ingest(
      { text: 'will fail', channel: 'compose', focus: 'whole', modeHint: 'quick' },
      deps,
    );
    worker.kick();
    await waitFor(() => ['done', 'failed'].includes(env.repo.getRun(out.run.id)?.status ?? ''));
    brain.nextResult = {};
    expect(env.repo.getRun(out.run.id)?.status).toBe('failed');
    expect(env.repo.getRun(out.run.id)?.error).toBe('boom');
    expect(env.repo.listMessages(out.chat.id).at(-1)?.kind).toBe('error');
    expect(env.repo.getItem(out.item.id)?.status).toBe('failed');
  });

  it('daily cap parks research runs as capped', async () => {
    const saved = env.cfg.dailyCapUsd;
    env.cfg.dailyCapUsd = 0.01; // already spent 0.02+
    const out = ingest(
      { text: 'capped', channel: 'compose', focus: 'whole', modeHint: 'quick' },
      deps,
    );
    worker.kick();
    await waitFor(() => env.repo.getRun(out.run.id)?.status === 'capped');
    env.cfg.dailyCapUsd = saved;
    expect(env.repo.getItem(out.item.id)?.status).toBe('capped');
    expect(env.repo.listMessages(out.chat.id).at(-1)?.content).toMatch(/daily cap/);
  });

  it('cancel aborts the in-flight run', async () => {
    brain.delayMs = 400;
    const out = ingest(
      { text: 'slow one', channel: 'compose', focus: 'whole', modeHint: 'quick' },
      deps,
    );
    worker.kick();
    await waitFor(() => env.repo.getRun(out.run.id)?.status === 'researching');
    expect(worker.cancel(out.run.id)).toBe(true);
    await waitFor(() => env.repo.getRun(out.run.id)?.status === 'failed');
    brain.delayMs = 0;
    expect(env.repo.getRun(out.run.id)?.error).toMatch(/cancelled/);
  });
});

describe('escalationIsMeaningful', () => {
  it('drops offers that negate themselves or do not go up a mode', () => {
    expect(
      escalationIsMeaningful(
        { mode: 'standard', reason: 'Content from source; no further research needed' },
        'quick',
      ),
    ).toBe(false);
    expect(escalationIsMeaningful({ mode: 'quick', reason: 'compare more' }, 'standard')).toBe(
      false,
    );
    expect(escalationIsMeaningful({ mode: 'standard', reason: 'x' }, 'standard')).toBe(false);
    expect(escalationIsMeaningful({ mode: 'bogus', reason: 'x' }, 'quick')).toBe(false);
  });
  it('keeps genuine offers', () => {
    expect(
      escalationIsMeaningful(
        { mode: 'deep', reason: 'Needs a price comparison across 5 vendors' },
        'quick',
      ),
    ).toBe(true);
  });
});
