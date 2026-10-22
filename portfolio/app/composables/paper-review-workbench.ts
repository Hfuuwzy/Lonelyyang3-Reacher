/**
 * Workbench route logic for `/prototype/paper-review` (the `index.vue` child):
 * the submittable form state, the SSE submission lifecycle, and the concise
 * result view state. Credentials (the API key) and the in-flight AbortController
 * live here — child-local page memory only, cleared on submit and unmount, and
 * never shared into the parent session.
 */

import { $fetch } from 'ofetch'
import type { FetchResponse } from 'ofetch'
import { PAPER_REVIEW_PROTOCOL_OPTIONS, paperReviewStageLabel } from '../components/prototype/paper-review-labels'
import type { PaperReviewStage } from '../utils/paper-review-contract'
import { paperReviewHttpErrorMessage } from '../utils/paper-review-http-error'
import { consumePaperReviewStream } from '../utils/paper-review-stream'
import type { PaperReviewStreamOutcome } from '../utils/paper-review-stream'
import type { PaperReviewTaskResult } from '../utils/paper-review-task-contract'
import type { PaperReviewSession } from './paper-review-session'

export interface PaperReviewWorkbench {
  readonly pdfFile: Ref<File | null>
  readonly providerLabel: Ref<string>
  readonly baseUrl: Ref<string>
  readonly protocol: Ref<string>
  readonly model: Ref<string>
  readonly apiKey: Ref<string>
  readonly submitting: Ref<boolean>
  readonly phase: Ref<'idle' | 'running' | 'result' | 'error'>
  readonly currentStage: Ref<PaperReviewStage>
  readonly errorMessage: Ref<string>
  readonly result: ComputedRef<PaperReviewTaskResult | null>
  readonly pdfUrl: ComputedRef<string | null>
  readonly pdfName: ComputedRef<string>
  readonly protocolLabel: ComputedRef<string>
  readonly handleSubmit: () => Promise<void>
  readonly handleReset: () => void
}

export function usePaperReviewWorkbench(session: PaperReviewSession | null): PaperReviewWorkbench {
  const pdfFile = ref<File | null>(null)
  const providerLabel = ref('')
  const baseUrl = ref('')
  const protocol = ref(PAPER_REVIEW_PROTOCOL_OPTIONS[0]?.value ?? '')
  const model = ref('')
  const apiKey = ref('')

  const submitting = ref(false)
  const currentStage = ref<PaperReviewStage>('validating')
  const errorMessage = ref('')

  // A re-entered workbench after child navigation restores its phase from the
  // parent-held session so the summary and reader links reappear.
  const phase = ref<'idle' | 'running' | 'result' | 'error'>(session?.result.value != null ? 'result' : 'idle')

  const result = computed(() => session?.result.value ?? null)
  const pdfUrl = computed(() => session?.pdfUrl.value ?? null)
  const pdfName = computed(() => session?.pdfName.value ?? '论文')

  const protocolLabel = computed(() =>
    PAPER_REVIEW_PROTOCOL_OPTIONS.find((option) => option.value === protocol.value)?.label ?? protocol.value,
  )

  let activeController: AbortController | null = null
  let disposed = false

  function isAbandoned(controller: AbortController): boolean {
    return disposed || controller.signal.aborted || activeController !== controller
  }

  function handlePageHide(): void {
    const controller = activeController
    if (controller === null) {
      return
    }
    controller.abort()
    if (!disposed) {
      submitting.value = false
      phase.value = 'error'
      errorMessage.value = '离开工作台，本次论文任务已取消；重新提交将启动全新任务。'
    }
  }

  async function handleSubmit(): Promise<void> {
    const file = pdfFile.value
    if (file === null) {
      return
    }

    const formData = new FormData()
    formData.append('pdf', file)
    formData.append('providerLabel', providerLabel.value.trim())
    formData.append('baseUrl', baseUrl.value.trim())
    formData.append('protocol', protocol.value)
    formData.append('model', model.value.trim())
    formData.append('apiKey', apiKey.value)
    apiKey.value = ''

    submitting.value = true
    phase.value = 'running'
    currentStage.value = 'validating'
    session?.clear()
    errorMessage.value = ''

    const controller = new AbortController()
    activeController = controller

    try {
      let response: FetchResponse<ReadableStream<Uint8Array>>
      try {
        response = await $fetch.raw('/api/prototype/paper-review', {
          method: 'POST',
          body: formData,
          responseType: 'stream',
          credentials: 'omit',
          retry: 0,
          ignoreResponseError: true,
          signal: controller.signal,
        })
      } catch (error) {
        if (isAbandoned(controller)) {
          return
        }
        if (!(error instanceof Error)) {
          throw error
        }
        phase.value = 'error'
        errorMessage.value = '无法连接到本地审阅端点。该工作台仅通过 npm run dev 提供，请确认开发服务器正在运行后重新提交。'
        submitting.value = false
        return
      }

      if (isAbandoned(controller)) {
        return
      }
      if (!response.ok || response.body === null) {
        phase.value = 'error'
        errorMessage.value = paperReviewHttpErrorMessage(response.status)
        submitting.value = false
        return
      }

      const stream = response.body
      const decoder = new TextDecoder()
      const source = (async function* (): AsyncGenerator<string> {
        for await (const chunk of stream) {
          yield decoder.decode(chunk, { stream: true })
        }
        yield decoder.decode()
      })()

      let outcome: PaperReviewStreamOutcome
      try {
        outcome = await consumePaperReviewStream(source, {
          onEvent: (event) => {
            if (isAbandoned(controller)) {
              return
            }
            if (event.type === 'stage') {
              currentStage.value = event.stage
            }
          },
        })
      } catch (error) {
        if (isAbandoned(controller)) {
          return
        }
        if (!(error instanceof Error)) {
          throw error
        }
        phase.value = 'error'
        errorMessage.value = '审阅连接中断，未收到完整结果。请检查网络或本地端点后重新提交（需重新输入密钥）。'
        submitting.value = false
        return
      }

      if (isAbandoned(controller)) {
        return
      }
      submitting.value = false

      if (outcome.kind === 'result') {
        // Adopt into the parent-held session so the report/translation routes
        // can read the same result and PDF URL after navigation.
        session?.adopt(outcome.result, file)
        phase.value = 'result'
        return
      }

      phase.value = 'error'
      if (outcome.error.type === 'stream-error') {
        errorMessage.value = outcome.error.message
      } else {
        errorMessage.value = `服务在「${paperReviewStageLabel(outcome.error.stage)}」阶段中止：${outcome.error.message}（错误码 ${outcome.error.code}）`
      }
    } finally {
      if (activeController === controller) {
        activeController = null
      }
    }
  }

  function handleReset(): void {
    // Reset is a full stop: the in-flight request must never adopt afterwards.
    activeController?.abort()
    activeController = null
    submitting.value = false
    pdfFile.value = null
    providerLabel.value = ''
    baseUrl.value = ''
    protocol.value = PAPER_REVIEW_PROTOCOL_OPTIONS[0]?.value ?? ''
    model.value = ''
    apiKey.value = ''
    currentStage.value = 'validating'
    session?.clear()
    errorMessage.value = ''
    phase.value = 'idle'
  }

  onMounted(() => {
    window.addEventListener('pagehide', handlePageHide)
  })

  onUnmounted(() => {
    disposed = true
    activeController?.abort()
    window.removeEventListener('pagehide', handlePageHide)
    apiKey.value = ''
  })

  return {
    pdfFile,
    providerLabel,
    baseUrl,
    protocol,
    model,
    apiKey,
    submitting,
    phase,
    currentStage,
    errorMessage,
    result,
    pdfUrl,
    pdfName,
    protocolLabel,
    handleSubmit,
    handleReset,
  }
}