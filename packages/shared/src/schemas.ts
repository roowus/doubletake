import { z } from 'zod';

export const Mode = z.enum(['quick', 'standard', 'deep']);
export type Mode = z.infer<typeof Mode>;
export const ModeRequested = z.enum(['auto', 'quick', 'standard', 'deep']);
export type ModeRequested = z.infer<typeof ModeRequested>;

export const QuestionType = z.enum([
  'is_it_true',
  'what_is_this',
  'how_to',
  'compare',
  'save_for_later',
  'explain_comments',
  'other',
]);
export type QuestionType = z.infer<typeof QuestionType>;

export const Platform = z.enum([
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'reddit',
  'web',
  'aichat',
  'text',
]);
export type Platform = z.infer<typeof Platform>;

export const Channel = z.enum([
  'android_share',
  'compose',
  'ig_dm',
  'ig_mention',
  'web_share_target',
  'library',
  'mcp',
  'import',
]);
export type Channel = z.infer<typeof Channel>;

/** `whole` | `comments` | `thread:<comment_id>` */
export const Focus = z.string().regex(/^(whole|comments|thread:[A-Za-z0-9_-]+)$/);
export type Focus = z.infer<typeof Focus>;

export const ItemStatus = z.enum([
  'new',
  'extracting',
  'researching',
  'answered',
  'failed',
  'capped',
]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const RunStatus = z.enum([
  'queued',
  'extracting',
  'researching',
  'done',
  'failed',
  'capped',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunKind = z.enum(['research', 'followup']);
export type RunKind = z.infer<typeof RunKind>;

export const Category = z.enum([
  'place',
  'food',
  'product',
  'tech',
  'skill',
  'health',
  'travel',
  'finance',
  'entertainment',
  'news',
  'other',
]);
export type Category = z.infer<typeof Category>;

export const EntityKind = z.enum([
  'place',
  'recipe',
  'product',
  'tool',
  'tip',
  'media',
  'person',
  'event',
  'other',
]);
export type EntityKind = z.infer<typeof EntityKind>;

export const Entity = z.object({
  kind: EntityKind,
  name: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
  url: z.string().url().optional(),
  confidence: z.number().min(0).max(1).default(0.7),
});
export type Entity = z.infer<typeof Entity>;

export const Claim = z.object({
  claim: z.string(),
  // Models often emit a JSON boolean here; accept it and normalise to the string form.
  verdict: z.preprocess(
    (v) => (v === true ? 'true' : v === false ? 'false' : v),
    z.enum(['true', 'false', 'mixed', 'unverified']),
  ),
  confidence: z.number().min(0).max(1).default(0.5),
  sources: z.array(z.string()).default([]),
});
export type Claim = z.infer<typeof Claim>;

/** Structured block every run returns alongside the Markdown answer (ADR 0014). */
export const Answer = z.object({
  summary: z.string(),
  category: Category.default('other'),
  entities: z.array(Entity).default([]),
  claims: z.array(Claim).default([]),
  recommendations: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  escalate: z.object({ mode: z.enum(['standard', 'deep']), reason: z.string() }).optional(),
});
export type Answer = z.infer<typeof Answer>;

export const Classification = z.object({
  mode: Mode,
  question_type: QuestionType,
  needs_comments: z.boolean().default(false),
});
export type Classification = z.infer<typeof Classification>;

/** What every channel normalises its input to. */
export const IngestRequest = z
  .object({
    url: z.string().url().optional(),
    text: z.string().max(20_000).optional(),
    note: z.string().max(4_000).optional(),
    channel: Channel,
    focus: Focus.default('whole'),
    modeHint: ModeRequested.default('auto'),
  })
  .refine((r) => r.url || (r.text && r.text.trim().length > 0), {
    message: 'url or text is required',
  });
export type IngestRequest = z.infer<typeof IngestRequest>;

export const RunEventType = z.enum(['status', 'tool_call', 'tool_result', 'text', 'error', 'done']);
export type RunEventType = z.infer<typeof RunEventType>;

export const RunEvent = z.object({
  runId: z.string(),
  chatId: z.string(),
  seq: z.number().int(),
  type: RunEventType,
  payload: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type RunEvent = z.infer<typeof RunEvent>;

// ---- API DTOs ----

export const ChatSummary = z.object({
  id: z.string(),
  itemId: z.string(),
  title: z.string(),
  platform: Platform,
  channel: Channel,
  status: ItemStatus,
  category: Category.nullable(),
  unreadCount: z.number().int(),
  lastMessageAt: z.string().nullable(),
  createdAt: z.string(),
  sourceUrl: z.string().nullable(),
  tags: z.array(z.string()),
});
export type ChatSummary = z.infer<typeof ChatSummary>;

export const MessageDto = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  kind: z.enum(['answer', 'followup', 'status', 'error', 'question']),
  content: z.string(),
  structured: Answer.nullable(),
  runId: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const RunDto = z.object({
  id: z.string(),
  kind: RunKind,
  mode: Mode,
  adapter: z.string(),
  model: z.string().nullable(),
  status: RunStatus,
  costUsd: z.number().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type RunDto = z.infer<typeof RunDto>;

export const ExtractionDto = z.object({
  id: z.string(),
  kind: z.string(),
  tool: z.string().nullable(),
  createdAt: z.string(),
  /** Flattened, human-readable text (transcript lines, OCR lines, comments…). */
  text: z.string(),
});
export type ExtractionDto = z.infer<typeof ExtractionDto>;

export const CollectionDto = z.object({
  id: z.string(),
  name: z.string(),
  /** `category:<c>`, `entity:<kind>`, `tag:<name>` or free FTS text; empty for manual. */
  query: z.string(),
  manual: z.boolean(),
  auto: z.boolean(),
  hidden: z.boolean(),
  count: z.number().int(),
  /** Public read-only page URL when the owner shares this collection (ADR 0025). */
  shareUrl: z.string().nullable(),
});
export type CollectionDto = z.infer<typeof CollectionDto>;

/** Where a place entity sits on the map (ADR 0022): from the brain's own lat/lon or the geocoder. */
export const EntityGeo = z.object({
  lat: z.number(),
  lon: z.number(),
  label: z.string().nullable(),
  source: z.enum(['brain', 'geocoder']),
});
export type EntityGeo = z.infer<typeof EntityGeo>;

export const EntityHit = Entity.extend({
  chatId: z.string(),
  itemTitle: z.string(),
  platform: Platform,
  createdAt: z.string(),
  /** Only on `place` entities that have been located; absent while geocoding is pending or failed. */
  geo: EntityGeo.optional(),
});
export type EntityHit = z.infer<typeof EntityHit>;

export const TagDto = z.object({
  name: z.string(),
  kind: z.enum(['auto', 'manual']),
  count: z.number().int(),
});
export type TagDto = z.infer<typeof TagDto>;

export const ChatDetail = z.object({
  chat: ChatSummary,
  item: z.object({
    note: z.string().nullable(),
    focus: Focus,
    modeRequested: ModeRequested,
    modeEffective: Mode.nullable(),
    questionType: QuestionType.nullable(),
    canonicalUrl: z.string().nullable(),
  }),
  messages: z.array(MessageDto),
  runs: z.array(RunDto),
  entities: z.array(Entity),
  extractions: z.array(ExtractionDto),
});
export type ChatDetail = z.infer<typeof ChatDetail>;
