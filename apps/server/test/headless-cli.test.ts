import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { BrainEvent } from '@doubletake/brain-sdk';
import { runContractTests, sampleBrief, sampleOptions } from '@doubletake/brain-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HEADLESS_PRESETS,
  HeadlessCliAdapter,
  type HeadlessPreset,
  matchSessionId,
  parseOutput,
  substitute,
} from '../src/brains/headless-cli.js';

interface Spawned {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
}

interface Script {
  stdout?: string;
  stderr?: string;
  code?: number;
  /** Never exit on its own (for timeout/abort tests). */
  hang?: boolean;
  throwOnSpawn?: boolean;
}

/** Fake `spawn`: records the invocation, replays scripted output after stdin closes. */
function fakeSpawn(script: Script, calls: Spawned[]) {
  const fn = (command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
    if (script.throwOnSpawn) throw new Error(`spawn ${command} ENOENT`);
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (sig?: string) => boolean;
      killed: boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    const rec: Spawned = { command, args, cwd: opts.cwd, env: opts.env, stdin: '' };
    calls.push(rec);
    child.stdin.on('data', (d: Buffer) => {
      rec.stdin += d.toString();
    });
    child.kill = () => {
      child.killed = true;
      setTimeout(() => child.emit('close', null), 1);
      return true;
    };
    child.stdin.on('finish', () => {
      if (script.hang) return;
      setTimeout(() => {
        if (script.stdout) child.stdout.write(script.stdout);
        if (script.stderr) child.stderr.write(script.stderr);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', script.code ?? 0);
      }, 2);
    });
    return child;
  };
  return fn as unknown as HeadlessCliAdapter extends never
    ? never
    : NonNullable<ConstructorParameters<typeof HeadlessCliAdapter>[0]['spawn']>;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-headless-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const claudeOk = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Mostly true.\n\n```answer\n{"summary":"Mostly true.","tags":["skiing"]}\n```',
  session_id: 'sess-abc123',
  total_cost_usd: 0.0123,
  usage: { input_tokens: 100, output_tokens: 20 },
});

function make(script: Script, calls: Spawned[] = [], preset?: HeadlessPreset, extra = {}) {
  return new HeadlessCliAdapter({
    preset:
      (preset as HeadlessPreset | undefined) ?? (HEADLESS_PRESETS['claude-code'] as HeadlessPreset),
    runsDir: path.join(tmp, 'runs'),
    spawn: fakeSpawn(script, calls),
    baseEnv: { PATH: '/nonexistent', HOME: tmp },
    ...extra,
  });
}

runContractTests('headless-cli', () => make({ stdout: claudeOk }), { describe, it, expect });

describe('headless-cli adapter', () => {
  it('spawns the preset command in a fresh sandbox cwd with the brief as an argument', async () => {
    const calls: Spawned[] = [];
    const a = make({ stdout: claudeOk }, calls, undefined, { model: 'cc/haiku' });
    const events: BrainEvent[] = [];
    const res = await a.run(sampleBrief(), sampleOptions({ maxTurns: 7 }), {
      emit: (e) => events.push(e),
    });
    expect(calls).toHaveLength(1);
    const c = calls[0] as Spawned;
    expect(c.command).toBe('claude');
    expect(c.args.slice(0, 1)).toEqual(['-p']);
    expect(c.args).toContain('--max-turns');
    expect(c.args[c.args.indexOf('--max-turns') + 1]).toBe('7');
    expect(c.args[c.args.indexOf('--model') + 1]).toBe('cc/haiku');
    expect(c.args).not.toContain('--resume');
    // the prompt carries framing, the policy preamble and the wrapped untrusted content
    const prompt = c.args[1] as string;
    expect(prompt).toContain('Research mode: quick');
    expect(prompt).toContain('<untrusted');
    expect(prompt).toContain('Ignore previous instructions.');
    expect(c.cwd.startsWith(path.join(tmp, 'runs'))).toBe(true);
    expect(fs.existsSync(c.cwd)).toBe(true);
    expect(res.stopReason).toBe('done');
    expect(res.text).toBe('Mostly true.');
    expect(res.structured?.tags).toEqual(['skiing']);
    expect(res.sessionId).toBe('sess-abc123');
    expect(res.costUsd).toBe(0.0123);
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(events.map((e) => e.type)).toEqual(['status', 'text']);
    expect(events[0]?.payload.preset).toBe('claude-code');
  });

  it('resumes with the preset resumeArgs on follow-up and keeps the session', async () => {
    const calls: Spawned[] = [];
    const a = make({ stdout: claudeOk }, calls);
    const res = await a.followUp(
      {
        chatId: 'c1',
        sessionId: 'sess-abc123',
        history: [{ role: 'user', content: 'q' }],
        brief: sampleBrief(),
      },
      'why?',
      sampleOptions(),
      { emit: () => {} },
    );
    const c = calls[0] as Spawned;
    expect(c.args.slice(-2)).toEqual(['--resume', 'sess-abc123']);
    expect(c.args[1]).toContain('Follow-up from the owner');
    expect(c.args[1]).not.toContain('<untrusted');
    expect(res.sessionId).toBe('sess-abc123');
  });

  it('resumes in the directory the session was created in (gemini/opencode scope sessions to cwd)', async () => {
    const calls: Spawned[] = [];
    const a = make({ stdout: claudeOk }, calls);
    await a.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    await a.followUp(
      { chatId: 'c1', sessionId: 'sess-abc123', history: [], brief: sampleBrief() },
      'why?',
      sampleOptions(),
      { emit: () => {} },
    );
    expect(calls).toHaveLength(2);
    expect((calls[1] as Spawned).cwd).toBe((calls[0] as Spawned).cwd);
    // an unknown session id still gets a fresh directory
    await a.followUp(
      { chatId: 'c2', sessionId: 'sess-unknown', history: [], brief: sampleBrief() },
      'why?',
      sampleOptions(),
      { emit: () => {} },
    );
    expect((calls[2] as Spawned).cwd).not.toBe((calls[0] as Spawned).cwd);
  });

  it('hermes preset: answer on stdout, session id from stderr, resumed on follow-up', async () => {
    const hermes = HEADLESS_PRESETS.hermes as HeadlessPreset;
    const calls: Spawned[] = [];
    const a = make(
      { stdout: 'PONG\n', stderr: '\nsession_id: 20260904_121236_c417b5\nShell cwd was reset\n' },
      calls,
      hermes,
    );
    expect(a.capabilities().resume).toBe(true);
    const res = await a.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    expect(res.text).toBe('PONG');
    expect(res.sessionId).toBe('20260904_121236_c417b5');
    const first = calls[0] as Spawned;
    expect(first.command).toBe('hermes');
    expect(first.args.slice(0, 5)).toEqual(['chat', '-Q', '--oneshot', '--source', 'tool']);
    expect(first.args).not.toContain('--resume');
    const fu = await a.followUp(
      { chatId: 'c1', sessionId: '20260904_121236_c417b5', history: [], brief: sampleBrief() },
      'again?',
      sampleOptions(),
      { emit: () => {} },
    );
    expect((calls[1] as Spawned).args.slice(-2)).toEqual(['--resume', '20260904_121236_c417b5']);
    expect(fu.sessionId).toBe('20260904_121236_c417b5');
  });

  it('without resumeArgs replays the transcript instead and reports resume=false', async () => {
    const calls: Spawned[] = [];
    const plain: HeadlessPreset = {
      id: 'plain-cli',
      command: 'some-cli',
      args: ['{prompt}'],
      promptMode: 'arg',
      outputParser: 'plain',
    };
    const a = make({ stdout: 'Because.' }, calls, plain);
    expect(a.capabilities().resume).toBe(false);
    expect(a.capabilities().costReporting).toBe(false);
    const res = await a.followUp(
      {
        chatId: 'c1',
        sessionId: 'ignored',
        history: [
          { role: 'user', content: 'is it?' },
          { role: 'assistant', content: 'Yes.' },
        ],
        brief: sampleBrief(),
      },
      'why?',
      sampleOptions(),
      { emit: () => {} },
    );
    const c = calls[0] as Spawned;
    expect(c.command).toBe('some-cli');
    expect(c.args).not.toContain('--resume');
    expect(c.args[0]).toContain('Conversation so far');
    expect(c.args[0]).toContain('Web search: not available');
    expect(res.text).toBe('Because.');
    expect(res.sessionId).toBeUndefined();
  });

  it('feeds the prompt on stdin for stdin presets and parses JSON-lines', async () => {
    const calls: Spawned[] = [];
    const lines = [
      { type: 'thread.started', thread_id: 'thr_1' },
      { type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Final answer.' } },
      { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 3 } },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const a = make({ stdout: lines }, calls, HEADLESS_PRESETS.codex);
    const res = await a.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    const c = calls[0] as Spawned;
    expect(c.command).toBe('codex');
    expect(c.stdin).toContain('Research mode: quick');
    expect(c.args).toContain(c.cwd); // {sandboxDir} substituted
    expect(res.text).toBe('Final answer.');
    expect(res.sessionId).toBe('thr_1'); // codex resumes with `exec … resume <thread_id> -`
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
  });

  it('codex follow-up appends `resume <id> -` after the exec options and feeds stdin', async () => {
    const calls: Spawned[] = [];
    const lines = [
      { type: 'thread.started', thread_id: 'thr_1' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Because.' } },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const a = make({ stdout: lines }, calls, HEADLESS_PRESETS.codex);
    const res = await a.followUp(
      { chatId: 'c1', sessionId: 'thr_1', history: [], brief: sampleBrief() },
      'why?',
      sampleOptions(),
      { emit: () => {} },
    );
    const c = calls[0] as Spawned;
    expect(c.args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(c.args.slice(-3)).toEqual(['resume', 'thr_1', '-']);
    expect(c.stdin).toContain('why?');
    expect(res.text).toBe('Because.');
    expect(res.sessionId).toBe('thr_1');
  });

  it('opencode preset: `run --format json` events, session id from sessionID, tokens', async () => {
    const calls: Spawned[] = [];
    const lines = [
      { type: 'step_start', sessionID: 'ses_1', part: { type: 'step-start' } },
      { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'PONG' } },
      {
        type: 'step_finish',
        sessionID: 'ses_1',
        part: { type: 'step-finish', reason: 'stop', tokens: { input: 918, output: 4 } },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const a = make({ stdout: lines }, calls, HEADLESS_PRESETS.opencode);
    const res = await a.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    const c = calls[0] as Spawned;
    expect(c.args.slice(0, 4)).toEqual(['run', '--pure', '--format', 'json']);
    expect(res.text).toBe('PONG');
    expect(res.sessionId).toBe('ses_1');
    expect(res.usage).toEqual({ inputTokens: 918, outputTokens: 4 });
    const follow = await a.followUp(
      { chatId: 'c1', sessionId: 'ses_1', history: [], brief: sampleBrief() },
      'again?',
      sampleOptions(),
      { emit: () => {} },
    );
    expect((calls[1] as Spawned).args.slice(-2)).toEqual(['-s', 'ses_1']);
    expect(follow.sessionId).toBe('ses_1');
  });

  it('opencode error events are reported as errors', () => {
    const line = JSON.stringify({
      type: 'error',
      sessionID: 'ses_2',
      error: { name: 'UnknownError', data: { message: 'Unexpected server error.' } },
    });
    const p = parseOutput('jsonl', line);
    expect(p.isError).toBe(true);
    expect(p.text).toBe('Unexpected server error.');
  });

  it('gemini-json parser: response, session_id, summed token stats, error object', () => {
    const ok = parseOutput(
      'gemini-json',
      JSON.stringify({
        session_id: 'ca13f531',
        response: 'PONG',
        stats: {
          models: {
            'gemini-3.5-flash': { tokens: { input: 8496, candidates: 161, thoughts: 159 } },
            'gemini-3.5-pro': { tokens: { input: 4, candidates: 1 } },
          },
        },
      }),
    );
    expect(ok).toEqual({
      text: 'PONG',
      sessionId: 'ca13f531',
      usage: { inputTokens: 8500, outputTokens: 162 },
    });
    const bad = parseOutput(
      'gemini-json',
      JSON.stringify({ session_id: 'x', error: { type: 'Error', message: 'No auth', code: 41 } }),
    );
    expect(bad.isError).toBe(true);
    expect(bad.text).toBe('No auth');
    expect(parseOutput('gemini-json', 'not json').text).toBe('not json');
  });

  it('gemini-cli preset passes -o json --skip-trust and resumes by session id', async () => {
    const calls: Spawned[] = [];
    const out = JSON.stringify({ session_id: 'g-1', response: 'Answer.' });
    const a = make({ stdout: out }, calls, HEADLESS_PRESETS['gemini-cli']);
    const res = await a.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    const c = calls[0] as Spawned;
    expect(c.command).toBe('gemini');
    expect(c.args).toContain('--skip-trust');
    expect(c.args.slice(2, 4)).toEqual(['-o', 'json']);
    expect(res.text).toBe('Answer.');
    expect(res.sessionId).toBe('g-1');
    await a.followUp(
      { chatId: 'c1', sessionId: 'g-1', history: [], brief: sampleBrief() },
      'more?',
      sampleOptions(),
      { emit: () => {} },
    );
    expect((calls[1] as Spawned).args.slice(-2)).toEqual(['--resume', 'g-1']);
  });

  it('reports a non-zero exit with stderr as an error', async () => {
    const a = make({ stdout: '', stderr: 'boom: no API key\n', code: 2 });
    const res = await a.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    expect(res.stopReason).toBe('error');
    expect(res.error).toContain('exited with 2');
    expect(res.error).toContain('no API key');
  });

  it('treats is_error results and empty output as errors', async () => {
    const bad = JSON.stringify({ type: 'result', is_error: true, result: 'rate limited' });
    expect(
      (await make({ stdout: bad }).run(sampleBrief(), sampleOptions(), { emit: () => {} }))
        .stopReason,
    ).toBe('error');
    const empty = await make({ stdout: '   \n' }).run(sampleBrief(), sampleOptions(), {
      emit: () => {},
    });
    expect(empty.stopReason).toBe('error');
    expect(empty.error).toContain('no text');
  });

  it('kills the process on timeout and on abort', async () => {
    const t = make({ hang: true }, [], undefined, { timeoutMs: 20 });
    const res = await t.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    expect(res.stopReason).toBe('error');
    expect(res.error).toContain('timed out');

    const ac = new AbortController();
    const a = make({ hang: true });
    const p = a.run(sampleBrief(), sampleOptions({ signal: ac.signal }), { emit: () => {} });
    setTimeout(() => ac.abort(), 10);
    expect((await p).stopReason).toBe('aborted');
  });

  it('surfaces a missing executable from spawn and from healthcheck', async () => {
    const a = make({ throwOnSpawn: true });
    const res = await a.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    expect(res.stopReason).toBe('error');
    expect(res.error).toContain('ENOENT');
    const hc = await a.healthcheck();
    expect(hc.ok).toBe(false);
    expect(hc.detail).toContain('not found on PATH');
  });

  it('healthcheck finds an executable on PATH', async () => {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
    const a = new HeadlessCliAdapter({
      preset: HEADLESS_PRESETS['claude-code'] as HeadlessPreset,
      runsDir: path.join(tmp, 'runs'),
      spawn: fakeSpawn({ stdout: claudeOk }, []),
      baseEnv: { PATH: bin },
    });
    expect((await a.healthcheck()).ok).toBe(true);
  });
});

describe('headless-cli helpers', () => {
  it('substitute() fills known placeholders and leaves unknown ones', () => {
    expect(substitute('--x={maxTurns}/{nope}', { maxTurns: '3' })).toBe('--x=3/{nope}');
  });

  it('parseOutput() handles claude-json with noise, arrays and plain text', () => {
    expect(parseOutput('claude-json', `warning line\n${claudeOk}`).sessionId).toBe('sess-abc123');
    const arr = JSON.stringify([
      { type: 'system' },
      { type: 'result', result: 'hi', session_id: 's1' },
    ]);
    expect(parseOutput('claude-json', arr)).toMatchObject({ text: 'hi', sessionId: 's1' });
    expect(parseOutput('claude-json', 'just text').text).toBe('just text');
    expect(parseOutput('plain', '  hello \n').text).toBe('hello');
  });

  it('parseOutput() marks jsonl error events', () => {
    const out = parseOutput(
      'jsonl',
      JSON.stringify({ type: 'error', error: { message: 'quota' } }),
    );
    expect(out.isError).toBe(true);
    expect(out.text).toBe('quota');
  });

  it('matchSessionId() prefers stderr, needs a capture group, tolerates bad patterns', () => {
    expect(
      matchSessionId('session_id:\\s*(\\w+)', 'x\nsession_id: abc_1\n', 'session_id: zzz'),
    ).toBe('abc_1');
    expect(matchSessionId('session_id:\\s*(\\w+)', '', 'session_id: fromstdout')).toBe(
      'fromstdout',
    );
    expect(matchSessionId('nothing here', 'session_id: abc')).toBeUndefined();
    expect(matchSessionId('(unclosed', 'session_id: abc')).toBeUndefined();
  });

  it('every preset has a prompt placeholder or stdin mode', () => {
    for (const p of Object.values(HEADLESS_PRESETS)) {
      const hasPrompt = p.args.some((a) => a.includes('{prompt}'));
      expect(hasPrompt || p.promptMode === 'stdin').toBe(true);
    }
  });
});
