/** Wire types for the media worker (docs/MEDIA-PIPELINE.md §Worker protocol). */

import type { Mode } from '@doubletake/shared';

export interface ExtractBudget {
  frames: number;
  vision_frames: number;
  comments: number;
  transcribe_model: Mode;
}

export interface ExtractParams {
  item_id: string;
  url: string;
  platform: string;
  focus: string;
  mode: Mode;
  hints: { cdn_url?: string; media_id?: string; comment_id?: string };
  budget: ExtractBudget;
  out_dir: string;
}

export interface WorkerAsset {
  kind: string;
  path: string;
  sha256: string;
  bytes: number;
  duration_s?: number;
  width?: number;
  height?: number;
  frame_ts_s?: number;
  source: string;
}

export interface WorkerExtraction {
  kind: string;
  tool: string;
  duration_ms: number;
  content: unknown;
}

export interface VisionRequest {
  frame_path: string;
  ts: number;
}

export interface ExtractOutput {
  assets: WorkerAsset[];
  extractions: WorkerExtraction[];
  vision_requests: VisionRequest[];
  warnings: string[];
  canonical_url: string | null;
  title: string | null;
}

export interface WorkerProgress {
  stage: string;
  pct: number;
  detail: string;
}

export interface WorkerErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export class MediaWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MediaWorkerError';
  }
}

/** What the queue worker depends on; the real client spawns a process, tests use a fake. */
export interface MediaClient {
  extract(
    params: ExtractParams,
    opts: { signal: AbortSignal; onProgress?: (p: WorkerProgress) => void },
  ): Promise<ExtractOutput>;
  ping(): Promise<boolean>;
  stop(): Promise<void>;
}
