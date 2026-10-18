import { $fetch } from 'ofetch'
import type { Ref } from 'vue'
import {
  paperTaskReaderPath,
  projectPaperTaskReaderView,
  type PaperTaskReaderView,
} from '../utils/paper-task-reader-contract'
import {
  usePaperTaskRequest,
  type PaperTaskRequest,
  type PaperTaskRequestState,
  type PaperTaskRequestTransport,
} from './paper-task-request'

export const PAPER_TASK_READER_TIMEOUT_MS = 10_000

export type PaperTaskReaderState = PaperTaskRequestState<PaperTaskReaderView>
export type PaperTaskReaderTransport = PaperTaskRequestTransport

export type PaperTaskReader = PaperTaskRequest<PaperTaskReaderView>

export interface PaperTaskReaderOptions {
  readonly transport?: PaperTaskReaderTransport
}

function getReader(taskId: string, signal: AbortSignal): Promise<unknown> {
  return $fetch<unknown>(paperTaskReaderPath(taskId), {
    method: 'GET',
    credentials: 'omit',
    retry: 0,
    signal,
  })
}

export function usePaperTaskReader(
  taskId: Readonly<Ref<string | null>>,
  ready: Readonly<Ref<boolean>>,
  options: PaperTaskReaderOptions = {},
): PaperTaskReader {
  return usePaperTaskRequest(taskId, ready, {
    transport: options.transport ?? getReader,
    project: projectPaperTaskReaderView,
    timeoutMs: PAPER_TASK_READER_TIMEOUT_MS,
  })
}
