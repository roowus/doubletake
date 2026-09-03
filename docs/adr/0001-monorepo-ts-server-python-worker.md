# 0001 — pnpm monorepo, TypeScript server, Python media worker

- Status: accepted
- Date: 2026-09-03

## Context
The server must host an HTTP API, a PWA, a job queue, webhook handlers, push senders, and
several AI adapters, and it must talk to media tooling (yt-dlp, ffmpeg, Whisper, OCR, local
vision models). The best client for the Claude Agent SDK, Fastify, and the PWA is TypeScript.
The best ecosystem for media and ML on CPU/Apple Silicon (mlx-whisper, faster-whisper,
RapidOCR, mlx-vlm, yt-dlp) is Python. The owner codes with an AI assistant and does not need
compatibility with any existing repo.

## Decision
Use a pnpm workspace with a TypeScript/Node 22 server (Fastify 5, drizzle-orm, zod, vitest,
biome) and a separate Python 3.12 media worker managed by uv, spawned by the server as a
long-lived child process speaking JSON-lines over stdio. Share types via `packages/shared`.

## Alternatives considered
- All-Python (FastAPI + HTMX): weaker Agent SDK story, worse PWA tooling, weaker typing across
  server and client.
- All-TypeScript (whisper via WASM/ONNX): transcription and OCR quality and speed on CPU lag the
  Python tools by a wide margin; local VLMs are Python-only in practice.
- Two independently deployed services over HTTP: more moving parts for a single-owner laptop
  install; kept as an option through `DOUBLETAKE_WORKER_URL`.

## Consequences
Two toolchains in CI (kept small and both green from day one). The worker protocol is a
contract that must be documented (MEDIA-PIPELINE.md). Type sharing stops at the TS boundary;
the worker's JSON is validated with zod on arrival.
