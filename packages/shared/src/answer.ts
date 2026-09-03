import { Answer } from './schemas.js';

const FENCE = /```(?:json)?\s*answer\s*\n([\s\S]*?)```/i;
const LAST_JSON_FENCE = /```json\s*\n([\s\S]*?)```\s*$/i;

/**
 * Split a model reply into the Markdown answer and the structured Answer block.
 * The block is requested as ```answer … ``` (or a trailing ```json fence). Lenient:
 * a missing or malformed block yields `structured: undefined` and the run still succeeds.
 */
export function parseAnswerBlock(raw: string): { text: string; structured: Answer | undefined } {
  const match = raw.match(FENCE) ?? raw.match(LAST_JSON_FENCE);
  if (!match) return { text: raw.trim(), structured: undefined };
  const jsonText = match[1] ?? '';
  let structured: Answer | undefined;
  try {
    const parsed = Answer.safeParse(JSON.parse(jsonText));
    if (parsed.success) structured = parsed.data;
  } catch {
    structured = undefined;
  }
  const text = raw.replace(match[0], '').trim();
  return { text, structured };
}
