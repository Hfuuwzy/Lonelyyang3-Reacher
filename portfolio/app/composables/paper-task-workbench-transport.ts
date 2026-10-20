import { $fetch } from 'ofetch'
import type { FetchResponse } from 'ofetch'
import type { PaperTaskEvent, PaperTaskSelection } from '../utils/paper-task-contract'
import { consumePaperTaskStream } from '../utils/paper-task-stream'
import type { PaperTaskStreamOutcome } from '../utils/paper-task-stream'

export interface PaperTaskSubmitRequest {
  readonly source: PaperTaskSubmitSource
  readonly selection: PaperTaskSelection
  readonly signal: AbortSignal
  readonly onEvent: (event: PaperTaskEvent) => void
}

export type PaperTaskSubmitSource =
  | { readonly kind: 'pdf'; readonly file: File }
  | { readonly kind: 'url'; readonly url: string }

export type PaperTaskSubmitResult =
  | { readonly kind: 'http-error'; readonly status: number }
  | { readonly kind: 'stream'; readonly outcome: PaperTaskStreamOutcome }

export interface PaperTaskWorkbenchTransport {
  readonly submit: (request: PaperTaskSubmitRequest) => Promise<PaperTaskSubmitResult>
  readonly cancel: (taskId: string) => Promise<unknown>
  readonly delete: (taskId: string) => Promise<unknown>
}

async function* decodeChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  for await (const chunk of body) {
    yield decoder.decode(chunk, { stream: true })
  }
  yield decoder.decode()
}

export function createPaperTaskWorkbenchTransport(): PaperTaskWorkbenchTransport {
  return {
    async submit(request) {
      const formData = new FormData()
      if (request.source.kind === 'pdf') {
        formData.append('pdf', request.source.file)
      } else {
        formData.append('sourceUrl', request.source.url)
      }
      formData.append('selection', request.selection)

      const response: FetchResponse<ReadableStream<Uint8Array>> = await $fetch.raw('/api/prototype/paper-task', {
        method: 'POST',
        body: formData,
        responseType: 'stream',
        credentials: 'omit',
        retry: 0,
        ignoreResponseError: true,
        signal: request.signal,
      })

      if (!response.ok || response.body === null) {
        return { kind: 'http-error', status: response.status }
      }

      const outcome = await consumePaperTaskStream(decodeChunks(response.body), {
        selection: request.selection,
        onEvent: request.onEvent,
      })
      return { kind: 'stream', outcome }
    },
    async cancel(taskId) {
      return await $fetch<unknown>(`/api/prototype/paper-task/${taskId}/cancel`, {
        method: 'POST',
        credentials: 'omit',
        retry: 0,
        ignoreResponseError: true,
      })
    },
    async delete(taskId) {
      return await $fetch<unknown>(`/api/prototype/paper-task/${taskId}`, {
        method: 'DELETE',
        credentials: 'omit',
        retry: 0,
        ignoreResponseError: true,
      })
    },
  }
}
