import { $fetch } from 'ofetch'
import type { Ref } from 'vue'
import {
  paperTaskTranslationPath,
  projectPaperTaskTranslationView,
  type PaperTaskTranslationView,
} from '../utils/paper-task-translation-contract'
import {
  usePaperTaskRequest,
  type PaperTaskRequest,
  type PaperTaskRequestState,
  type PaperTaskRequestTransport,
} from './paper-task-request'

export const PAPER_TASK_TRANSLATION_TIMEOUT_MS = 10_000

export type PaperTaskTranslationState = PaperTaskRequestState<PaperTaskTranslationView>
export type PaperTaskTranslationTransport = PaperTaskRequestTransport

export type PaperTaskTranslation = PaperTaskRequest<PaperTaskTranslationView>

export interface PaperTaskTranslationOptions {
  readonly transport?: PaperTaskTranslationTransport
}

function getTranslation(taskId: string, signal: AbortSignal): Promise<unknown> {
  return $fetch<unknown>(paperTaskTranslationPath(taskId), {
    method: 'GET',
    credentials: 'omit',
    retry: 0,
    signal,
  })
}

export function usePaperTaskTranslation(
  taskId: Readonly<Ref<string | null>>,
  ready: Readonly<Ref<boolean>>,
  options: PaperTaskTranslationOptions = {},
): PaperTaskTranslation {
  return usePaperTaskRequest(taskId, ready, {
    transport: options.transport ?? getTranslation,
    project: projectPaperTaskTranslationView,
    timeoutMs: PAPER_TASK_TRANSLATION_TIMEOUT_MS,
  })
}
