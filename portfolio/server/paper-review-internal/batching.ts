/**
 * Internal batching helpers for the paper-review pipeline (issue #29).
 *
 * Lives outside `server/utils` so Nuxt's auto-import scanner never treats these
 * pure helpers as composables. They partition a list of items (by unit count and
 * actual serialized character budget) into bounded, sequentially-ordered batches
 * so the pipeline can bound inventory, translation, and source-review model
 * requests. An item that alone exceeds the budget is still sent whole (its own
 * batch) — it is never silently truncated; an oversize gap is the validator's
 * decision, not the batching helpers'.
 */

/** Max items per model-request batch. */
export const MAX_UNITS_PER_BATCH = 40
/** Max serialized characters per model-request batch. */
export const MAX_CHARS_PER_BATCH = 6000
/** Fixed JSON wrapper overhead per prompt (purpose, instructions, keys...). */
export const PROMPT_SERIALIZED_OVERHEAD = 300
/** Per-page render overhead in the report prompt (page header + heading lines). */
export const PAGE_REPORT_OVERHEAD = 96
/**
 * Hard ceiling on the serialized length of any actual built prompt. The rough
 * partition estimate is only a first split; the exact builder output is gated
 * against this budget before a request is sent. An over-cap prompt is reported
 * as a localized gap, never truncated or blindly sent.
 */
export const PROMPT_CHAR_BUDGET = 24000

/** The serialized size of one `{id,text}` record as it appears in a prompt JSON array. */
function serializedRecord(item: { readonly id: string; readonly text: string }): number {
  return JSON.stringify({ id: item.id, text: item.text }).length
}

/**
 * Partition items into bounded batches, preserving order. A batch never exceeds
 * `maxUnits` items or `maxChars` serialized characters (per-record JSON plus the
 * fixed prompt wrapper), not just the raw text length.
 */
export function partitionIds(
  items: readonly { readonly id: string; readonly text: string }[],
  maxUnits = MAX_UNITS_PER_BATCH,
  maxChars = MAX_CHARS_PER_BATCH,
): readonly (readonly string[])[] {
  const budget = maxChars - PROMPT_SERIALIZED_OVERHEAD
  const batches: string[][] = []
  let current: string[] = []
  let units = 0
  let chars = 0
  for (const item of items) {
    const itemChars = serializedRecord(item)
    if (current.length > 0 && (units + 1 > maxUnits || chars + itemChars > budget)) {
      batches.push(current)
      current = []
      units = 0
      chars = 0
    }
    current.push(item.id)
    units += 1
    chars += itemChars
  }
  if (current.length > 0) {
    batches.push(current)
  }
  return batches
}

/**
 * Partition arbitrary text-carrying items (e.g. pages) into bounded, order-kept
 * batches by their rendered serialized size (text plus the per-page report
 * header, plus the fixed report prompt overhead), so the report prompt stays
 * bounded without losing source coverage. An oversized single page is still
 * emitted whole in its own chunk, never truncated.
 */
export function partitionPagesByText<T extends { readonly text: string }>(
  items: readonly T[],
  maxChars = MAX_CHARS_PER_BATCH,
  fixedOverhead = PROMPT_SERIALIZED_OVERHEAD,
): readonly (readonly T[])[] {
  const budget = maxChars - fixedOverhead
  const chunks: T[][] = []
  let current: T[] = []
  let chars = 0
  for (const item of items) {
    const itemChars = item.text.length + PAGE_REPORT_OVERHEAD
    if (current.length > 0 && chars + itemChars > budget) {
      chunks.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += itemChars
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}