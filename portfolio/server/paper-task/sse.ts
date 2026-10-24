import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'

/**
 * Frames task events as blank-line-delimited server-sent events.
 * @param events - event stream to serialize as it yields.
 * @returns one `data:` frame per task event.
 */
export async function* renderPaperTaskSse(events: AsyncIterable<PaperTaskEvent>): AsyncGenerator<string> {
  for await (const event of events) {
    yield `data: ${JSON.stringify(event)}\n\n`
  }
}
