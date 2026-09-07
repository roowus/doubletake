import { z } from 'zod';

/**
 * The ```chart fence: a small JSON spec the brain writes and the web app draws as themed SVG
 * (components/Chart.tsx). Kept deliberately tiny — four shapes, no options — so a model can
 * emit it reliably and the renderer never has to trust anything but numbers and short labels.
 * The same spec is documented verbatim in the system prompt (apps/server/src/brains/prompts.ts).
 */

export const CHART_MAX_SERIES = 8;
export const CHART_MAX_POINTS = 60;
export const CHART_MAX_LABEL = 80;

const Label = z.string().trim().min(1).max(CHART_MAX_LABEL);
const Num = z.number().finite();

export const ChartPoint = z.object({ x: z.union([Label, Num]), y: Num });
export type ChartPoint = z.infer<typeof ChartPoint>;

export const ChartSeries = z.object({
  name: Label,
  values: z.array(ChartPoint).min(1).max(CHART_MAX_POINTS),
});
export type ChartSeries = z.infer<typeof ChartSeries>;

const Base = {
  title: Label.optional(),
  unit: z.string().trim().max(16).optional(),
};

export const SeriesChart = z.object({
  ...Base,
  type: z.enum(['bar', 'line']),
  series: z.array(ChartSeries).min(1).max(CHART_MAX_SERIES),
});

/** A pie takes exactly one series; its points are the slices. */
export const PieChart = z.object({
  ...Base,
  type: z.literal('pie'),
  series: z.array(ChartSeries).length(1),
});

/** A stat block is a row of headline numbers with an optional change. */
export const StatChart = z.object({
  ...Base,
  type: z.literal('stat'),
  rows: z
    .array(z.object({ label: Label, value: z.union([Label, Num]), delta: Label.optional() }))
    .min(1)
    .max(12),
});

export const ChartSpec = z.discriminatedUnion('type', [SeriesChart, PieChart, StatChart]);
export type ChartSpec = z.infer<typeof ChartSpec>;
export type SeriesChart = z.infer<typeof SeriesChart>;
export type PieChart = z.infer<typeof PieChart>;
export type StatChart = z.infer<typeof StatChart>;

/**
 * Parse the text of a ```chart fence. Returns the spec or a short reason the reader can be
 * shown next to the raw block ("couldn't draw this: …"). Never throws.
 */
export function parseChartSpec(
  text: string,
): { ok: true; spec: ChartSpec } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  const parsed = ChartSpec.safeParse(json);
  if (parsed.success) return { ok: true, spec: parsed.data };
  const first = parsed.error.issues[0];
  const path = first?.path.length ? `${first.path.join('.')}: ` : '';
  return { ok: false, reason: `${path}${first?.message ?? 'invalid spec'}` };
}
