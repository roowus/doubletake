import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { OPEN_POLICY, runContractTests, sampleBrief, sampleOptions } from '@doubletake/brain-sdk';
import { describe, expect, it } from 'vitest';
import { ClaudeAgentSdkAdapter } from '../src/brains/claude-agent-sdk.js';

type QueryParams = Parameters<typeof import('@anthropic-ai/claude-agent-sdk').query>[0];

/** A fake `query` that replays a scripted message stream and records what it was called with. */
function fakeQuery(script: (params: QueryParams) => SDKMessage[], calls: QueryParams[] = []) {
  const fn = (params: QueryParams) => {
    calls.push(params);
    const msgs = script(params);
    const gen = (async function* () {
      for (const m of msgs) {
        if (params.options?.abortController?.signal.aborted) throw new Error('aborted');
        await new Promise((r) => setTimeout(r, 1));
        yield m;
      }
    })();
    return Object.assign(gen, {
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      close: () => {},
    }) as unknown as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;
  };
  return fn as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;
}

const SID = 'sess-123';
const init = (): SDKMessage =>
  ({
    type: 'system',
    subtype: 'init',
    session_id: SID,
    model: 'fake',
    tools: ['WebSearch'],
    uuid: 'u1',
    cwd: '/',
    apiKeySource: 'none',
    mcp_servers: [],
    permissionMode: 'dontAsk',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    agents: [],
    claude_code_version: '0',
  }) as unknown as SDKMessage;
const assistant = (content: unknown[]): SDKMessage =>
  ({
    type: 'assistant',
    session_id: SID,
    uuid: 'u2',
    parent_tool_use_id: null,
    message: {
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'fake',
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }) as unknown as SDKMessage;
const success = (result: string): SDKMessage =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    session_id: SID,
    uuid: 'u3',
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 1,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
    modelUsage: {},
    permission_denials: [],
  }) as unknown as SDKMessage;
const maxTurns = (): SDKMessage =>
  ({
    type: 'result',
    subtype: 'error_max_turns',
    is_error: true,
    errors: ['hit the turn limit'],
    session_id: SID,
    uuid: 'u3',
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 6,
    total_cost_usd: 0.2,
    usage: { input_tokens: 10, output_tokens: 20 },
    modelUsage: {},
    permission_denials: [],
  }) as unknown as SDKMessage;

const ANSWER = `Yes, mostly true. See https://example.com.

\`\`\`answer
{"summary":"Mostly true.","category":"skill","entities":[{"kind":"tip","name":"Bend your knees","attributes":{},"confidence":0.9}],"claims":[{"claim":"Skiing tip 1","verdict":true,"confidence":0.8,"sources":["https://example.com"]}],"recommendations":["Try it"],"tags":["skiing","tips"]}
\`\`\``;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-sdk-'));

runContractTests(
  'claude-agent-sdk (fake query)',
  () =>
    new ClaudeAgentSdkAdapter({
      cwd: tmp,
      query: fakeQuery(() => [
        init(),
        assistant([{ type: 'text', text: ANSWER }]),
        success(ANSWER),
      ]),
    }),
  { describe, it, expect },
);

describe('claude-agent-sdk adapter', () => {
  it('parses the answer block, reports cost and session id, and emits events', async () => {
    const calls: QueryParams[] = [];
    const adapter = new ClaudeAgentSdkAdapter({
      cwd: tmp,
      model: 'fake-model',
      query: fakeQuery(
        () => [
          init(),
          assistant([
            { type: 'tool_use', id: 't1', name: 'WebSearch', input: { query: 'skiing' } },
          ]),
          assistant([{ type: 'text', text: ANSWER }]),
          success(ANSWER),
        ],
        calls,
      ),
    });
    const events: string[] = [];
    const res = await adapter.run(
      sampleBrief(),
      sampleOptions({ mode: 'standard', tools: { ...OPEN_POLICY, readRoots: [tmp] } }),
      { emit: (e) => events.push(e.type) },
    );
    expect(res.stopReason).toBe('done');
    expect(res.sessionId).toBe(SID);
    expect(res.costUsd).toBeCloseTo(0.0123);
    expect(res.structured?.category).toBe('skill');
    expect(res.structured?.entities[0]?.name).toBe('Bend your knees');
    expect(res.text).not.toContain('```answer');
    expect(events).toEqual(['status', 'tool_call', 'text']);
    const opts = calls[0]?.options;
    expect(opts?.permissionMode).toBe('dontAsk');
    expect(opts?.model).toBe('fake-model');
    expect(opts?.allowedTools).toContain('mcp__doubletake__read_file');
    expect(opts?.disallowedTools).toContain('Bash');
    expect(opts?.resume).toBeUndefined();
  });

  it('maps error_max_turns to max_turns and keeps the last text', async () => {
    const adapter = new ClaudeAgentSdkAdapter({
      cwd: tmp,
      query: fakeQuery(() => [init(), assistant([{ type: 'text', text: 'partial' }]), maxTurns()]),
    });
    const res = await adapter.run(sampleBrief(), sampleOptions(), { emit: () => {} });
    expect(res.stopReason).toBe('max_turns');
    expect(res.text).toBe('partial');
    expect(res.sessionId).toBe(SID);
    expect(res.error).toContain('turn limit');
  });

  it('resumes the session on follow-up and does not advertise write tools without a writeRoot', async () => {
    const calls: QueryParams[] = [];
    const adapter = new ClaudeAgentSdkAdapter({
      cwd: tmp,
      query: fakeQuery(() => [init(), success('ok')], calls),
    });
    await adapter.followUp(
      { chatId: 'c1', sessionId: SID, history: [], brief: sampleBrief() },
      'and then?',
      sampleOptions({ tools: { ...OPEN_POLICY, writeRoot: null } }),
      { emit: () => {} },
    );
    expect(calls[0]?.options?.resume).toBe(SID);
    expect(calls[0]?.options?.allowedTools).not.toContain('mcp__doubletake__write_sandbox_file');
    expect(String(calls[0]?.prompt)).toContain('and then?');
  });

  it('canUseTool denies unknown tools and enforces the search budget', async () => {
    const calls: QueryParams[] = [];
    const adapter = new ClaudeAgentSdkAdapter({
      cwd: tmp,
      query: fakeQuery(() => [init(), success('ok')], calls),
    });
    await adapter.run(sampleBrief(), sampleOptions({ tools: { ...OPEN_POLICY, maxSearches: 1 } }), {
      emit: () => {},
    });
    const can = calls[0]?.options?.canUseTool;
    expect(can).toBeDefined();
    if (!can) return;
    const ctx = { signal: new AbortController().signal, toolUseID: 'x', requestId: 'r' };
    expect((await can('Bash', { command: 'ls' }, ctx))?.behavior).toBe('deny');
    expect((await can('WebSearch', { query: 'a' }, ctx))?.behavior).toBe('allow');
    expect((await can('WebSearch', { query: 'b' }, ctx))?.behavior).toBe('deny');
  });
});
