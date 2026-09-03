# 0003 — Pluggable brain adapter interface

- Status: accepted
- Date: 2026-09-03

## Context
The owner wants Claude Agent SDK today, but also any headless CLI harness (Claude Code
`claude -p`, Codex, Gemini CLI, OpenCode, Hermes, DeepSeek-based tools) and any
OpenAI- or Anthropic-compatible API (DeepSeek, Ollama, LM Studio, their own rewter router).
Follow-ups need cheap turns that reuse context, which only some backends can do natively.

## Decision
Define `BrainAdapter` in `packages/brain-sdk` with `run`, `followUp`, optional
`describeImages` and `classify`, `capabilities()`, and `healthcheck()`. Ship three v1
adapters: `claude-agent-sdk` (default), `headless-cli` (preset-driven process runner),
`openai-compatible` (our own tool loop and conversation storage). Tool policy is a typed object
enforced by code on our side wherever we control the loop. Selection: default, per mode, per run.

## Alternatives considered
- Only the Agent SDK: locks the project to one vendor; contradicts the open-source goal.
- Only a bare API with our loop: loses the SDK's built-in session management, tool quality,
  and cost accounting.
- LangChain/LlamaIndex style frameworks: heavy dependency for three adapters and a small loop.

## Consequences
Capability degradation is explicit: adapters without `resume` get follow-ups by replaying a
condensed history we store. Contract tests keep third-party adapters honest. The SDK is
confined to one file so API churn stays local.
