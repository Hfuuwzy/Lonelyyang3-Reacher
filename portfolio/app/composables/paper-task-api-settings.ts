import { onMounted, onUnmounted, reactive, ref, type Ref } from 'vue'
import {
  paperTaskProviderSettingsSchema,
  type PaperTaskProviderPublicStatus,
  type PaperTaskProviderSettings,
} from '../utils/paper-task-provider-contract'
import {
  parseCompletePaperTaskPublicStatus,
  parsePaperTaskPublicStatus,
} from '../utils/paper-task-api-settings-status'
import {
  createPaperTaskApiSettingsTransport,
  type PaperTaskApiSettingsTransport,
} from './paper-task-api-settings-transport'

export type PaperTaskApiSettingsPhase = 'loading' | 'ready' | 'applying' | 'clearing' | 'error'

export type PaperTaskApiSettingsNotice =
  | 'invalid-settings'
  | 'load-failed'
  | 'apply-failed'
  | 'clear-failed'
  | 'applied'
  | 'cleared'
  | null

export interface PaperTaskApiSettingsLifecycleCallbacks {
  readonly mounted: () => Promise<void>
  readonly pageHide: () => void
  readonly dispose: () => void
}

export interface PaperTaskApiSettingsOptions {
  readonly transport?: PaperTaskApiSettingsTransport
  readonly registerLifecycle?: (callbacks: PaperTaskApiSettingsLifecycleCallbacks) => void
}

export interface PaperTaskApiSettingsForm {
  providerLabel: string
  baseUrl: string
  protocol: PaperTaskProviderSettings['protocol']
  model: string
  imageInput: boolean
  apiKey: string
}

export interface PaperTaskApiSettingsController {
  readonly form: PaperTaskApiSettingsForm
  readonly phase: Ref<PaperTaskApiSettingsPhase>
  readonly notice: Ref<PaperTaskApiSettingsNotice>
  readonly status: Ref<PaperTaskProviderPublicStatus | null>
  readonly handleApply: () => Promise<void>
  readonly handleClear: () => Promise<void>
  readonly handleReload: () => Promise<void>
}

function registerVueLifecycle(callbacks: PaperTaskApiSettingsLifecycleCallbacks): void {
  onMounted(() => {
    window.addEventListener('pagehide', callbacks.pageHide)
    void callbacks.mounted()
  })
  onUnmounted(() => {
    window.removeEventListener('pagehide', callbacks.pageHide)
    callbacks.dispose()
  })
}

export function usePaperTaskApiSettings(
  options: PaperTaskApiSettingsOptions = {},
): PaperTaskApiSettingsController {
  const transport = options.transport ?? createPaperTaskApiSettingsTransport()
  const registerLifecycle = options.registerLifecycle ?? registerVueLifecycle
  const form = reactive<PaperTaskApiSettingsForm>({
    providerLabel: '',
    baseUrl: '',
    protocol: 'openai-completions',
    model: '',
    imageInput: false,
    apiKey: '',
  })
  const phase = ref<PaperTaskApiSettingsPhase>('loading')
  const notice = ref<PaperTaskApiSettingsNotice>(null)
  const status = ref<PaperTaskProviderPublicStatus | null>(null)
  let activeController: AbortController | null = null
  let disposed = false

  function beginRequest(): AbortController {
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    return controller
  }

  function isCurrent(controller: AbortController): boolean {
    return !disposed && !controller.signal.aborted && activeController === controller
  }

  function finishRequest(controller: AbortController): void {
    if (activeController === controller) {
      activeController = null
    }
  }

  function adoptStatus(nextStatus: PaperTaskProviderPublicStatus): void {
    status.value = nextStatus
    form.imageInput = nextStatus.imageInput
    if (!nextStatus.configured) {
      return
    }
    form.providerLabel = nextStatus.providerLabel ?? ''
    form.baseUrl = nextStatus.baseUrl ?? ''
    form.protocol = nextStatus.protocol ?? 'openai-completions'
    form.model = nextStatus.model ?? ''
  }

  async function handleReload(): Promise<void> {
    if (phase.value !== 'error' && phase.value !== 'loading') {
      return
    }
    const controller = beginRequest()
    phase.value = 'loading'
    notice.value = null
    try {
      const response = await transport.get(controller.signal)
      if (!isCurrent(controller)) {
        return
      }
      const nextStatus = response.ok ? parseCompletePaperTaskPublicStatus(response.body) : null
      if (nextStatus === null) {
        phase.value = 'error'
        notice.value = 'load-failed'
        return
      }
      adoptStatus(nextStatus)
      phase.value = 'ready'
    } catch (error) {
      if (!isCurrent(controller)) {
        return
      }
      if (!(error instanceof Error)) {
        throw error
      }
      phase.value = 'error'
      notice.value = 'load-failed'
    } finally {
      finishRequest(controller)
    }
  }

  async function handleApply(): Promise<void> {
    if (phase.value !== 'ready') {
      return
    }

    const parsed = paperTaskProviderSettingsSchema.safeParse({
      providerLabel: form.providerLabel,
      baseUrl: form.baseUrl,
      protocol: form.protocol,
      model: form.model,
      imageInput: form.imageInput,
      apiKey: form.apiKey,
    })
    form.apiKey = ''
    notice.value = null
    if (!parsed.success) {
      notice.value = 'invalid-settings'
      return
    }

    const submittedSettings = parsed.data
    const expectedKeyConfigured = submittedSettings.apiKey.length > 0
    const controller = beginRequest()
    phase.value = 'applying'
    try {
      const response = await transport.put(submittedSettings, controller.signal)
      submittedSettings.apiKey = ''
      if (!isCurrent(controller)) {
        return
      }
      const savedStatus = response.ok ? parsePaperTaskPublicStatus(response.body) : null
      if (
        savedStatus === null
        || !savedStatus.configured
        || savedStatus.apiKeyConfigured !== expectedKeyConfigured
        || savedStatus.imageInput !== submittedSettings.imageInput
      ) {
        phase.value = 'error'
        notice.value = 'apply-failed'
        return
      }

      const currentResponse = await transport.get(controller.signal)
      if (!isCurrent(controller)) {
        return
      }
      const currentStatus = currentResponse.ok ? parseCompletePaperTaskPublicStatus(currentResponse.body) : null
      if (currentStatus === null || !currentStatus.configured) {
        phase.value = 'error'
        notice.value = 'apply-failed'
        return
      }
      adoptStatus(currentStatus)
      phase.value = 'ready'
      notice.value = 'applied'
    } catch (error) {
      if (!isCurrent(controller)) {
        return
      }
      if (!(error instanceof Error)) {
        throw error
      }
      phase.value = 'error'
      notice.value = 'apply-failed'
    } finally {
      submittedSettings.apiKey = ''
      finishRequest(controller)
    }
  }

  async function handleClear(): Promise<void> {
    if (phase.value !== 'ready' || status.value?.configured !== true) {
      return
    }

    const controller = beginRequest()
    phase.value = 'clearing'
    notice.value = null
    try {
      const response = await transport.delete(controller.signal)
      if (!isCurrent(controller)) {
        return
      }
      const clearedStatus = response.ok ? parsePaperTaskPublicStatus(response.body) : null
      if (clearedStatus === null || clearedStatus.configured || clearedStatus.imageInput || clearedStatus.apiKeyConfigured) {
        phase.value = 'error'
        notice.value = 'clear-failed'
        return
      }
      status.value = clearedStatus
      form.providerLabel = ''
      form.baseUrl = ''
      form.protocol = 'openai-completions'
      form.model = ''
      form.imageInput = false
      form.apiKey = ''
      phase.value = 'ready'
      notice.value = 'cleared'
    } catch (error) {
      if (!isCurrent(controller)) {
        return
      }
      if (!(error instanceof Error)) {
        throw error
      }
      phase.value = 'error'
      notice.value = 'clear-failed'
    } finally {
      finishRequest(controller)
    }
  }

  registerLifecycle({
    mounted: handleReload,
    pageHide: () => {
      form.apiKey = ''
      activeController?.abort()
    },
    dispose: () => {
      disposed = true
      form.apiKey = ''
      activeController?.abort()
    },
  })

  return { form, phase, notice, status, handleApply, handleClear, handleReload }
}
