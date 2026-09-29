<template>
  <section data-testid="paper-review-page" class="paper-review-page">
    <PaperSectionHeading
      stamp="原型"
      english="PAPER REVIEW"
      title="论文研究审阅工作台"
      description="单篇 PDF 的本地研究审阅原型：由你自带的模型端点完成抽文、分析并与原文核验。仅通过开发服务器提供，不属于生产站点内容。"
    />

    <PaperReviewDisclosure
      :provider-label="providerLabel"
      :base-url="baseUrl"
      :protocol-label="protocolLabel"
    />

    <PaperReviewForm
      v-model:pdf-file="pdfFile"
      v-model:provider-label="providerLabel"
      v-model:base-url="baseUrl"
      v-model:protocol="protocol"
      v-model:model="model"
      v-model:api-key="apiKey"
      :submitting="submitting"
      @submit="handleSubmit"
      @reset="handleReset"
    />

    <PaperReviewProgress v-if="phase === 'running'" :current-stage="currentStage" />

    <PaperReviewError v-if="errorMessage" :message="errorMessage" />

    <PaperReviewReport v-if="report" :report="report" />
  </section>
</template>

<script setup lang="ts">
import { $fetch } from 'ofetch'
import type { FetchResponse } from 'ofetch'
import PaperSectionHeading from '~/components/content/PaperSectionHeading.vue'
import PaperReviewDisclosure from '~/components/prototype/PaperReviewDisclosure.vue'
import PaperReviewForm from '~/components/prototype/PaperReviewForm.vue'
import PaperReviewProgress from '~/components/prototype/PaperReviewProgress.vue'
import PaperReviewError from '~/components/prototype/PaperReviewError.vue'
import PaperReviewReport from '~/components/prototype/PaperReviewReport.vue'
import { PAPER_REVIEW_PROTOCOL_OPTIONS, paperReviewStageLabel } from '~/components/prototype/paper-review-labels'
import type { PaperReviewReport, PaperReviewStage } from '~/utils/paper-review-contract'
import { paperReviewHttpErrorMessage } from '~/utils/paper-review-http-error'
import { consumePaperReviewStream } from '~/utils/paper-review-stream'
import type { PaperReviewStreamOutcome } from '~/utils/paper-review-stream'

definePageMeta({ layout: 'default' })

const pdfFile = ref<File | null>(null)
const providerLabel = ref('')
const baseUrl = ref('')
const protocol = ref(PAPER_REVIEW_PROTOCOL_OPTIONS[0]?.value ?? '')
const model = ref('')
const apiKey = ref('')

const submitting = ref(false)
const phase = ref<'idle' | 'running' | 'report' | 'error'>('idle')
const currentStage = ref<PaperReviewStage>('validating')
const report = ref<PaperReviewReport | null>(null)
const errorMessage = ref('')

const protocolLabel = computed(() =>
  PAPER_REVIEW_PROTOCOL_OPTIONS.find((option) => option.value === protocol.value)?.label ?? protocol.value,
)

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
  report.value = null
  errorMessage.value = ''

  let response: FetchResponse<ReadableStream<Uint8Array>>
  try {
    response = await $fetch.raw('/api/prototype/paper-review', {
      method: 'POST',
      body: formData,
      responseType: 'stream',
      credentials: 'omit',
      retry: 0,
      ignoreResponseError: true,
    })
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    phase.value = 'error'
    errorMessage.value = '无法连接到本地审阅端点。该工作台仅通过 npm run dev 提供，请确认开发服务器正在运行后重新提交。'
    submitting.value = false
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
        if (event.type === 'stage') {
          currentStage.value = event.stage
        }
      },
    })
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    phase.value = 'error'
    errorMessage.value = '审阅连接中断，未收到完整结果。请检查网络或本地端点后重新提交（需重新输入密钥）。'
    submitting.value = false
    return
  }

  submitting.value = false

  if (outcome.kind === 'report') {
    report.value = outcome.report
    phase.value = 'report'
    return
  }

  const failure = outcome.error
  if (failure.type === 'stream-error') {
    phase.value = 'error'
    errorMessage.value = failure.message
    return
  }

  phase.value = 'error'
  errorMessage.value = `服务在「${paperReviewStageLabel(failure.stage)}」阶段中止：${failure.message}（错误码 ${failure.code}）`
}

function handleReset(): void {
  pdfFile.value = null
  providerLabel.value = ''
  baseUrl.value = ''
  protocol.value = PAPER_REVIEW_PROTOCOL_OPTIONS[0]?.value ?? ''
  model.value = ''
  apiKey.value = ''
  currentStage.value = 'validating'
  report.value = null
  errorMessage.value = ''
  phase.value = 'idle'
}

onUnmounted(() => {
  apiKey.value = ''
})
</script>

<style scoped>
.paper-review-page {
  display: grid;
  justify-items: center;
  gap: 48px;
  padding: 64px clamp(32px, 8vw, 96px) 160px;
}

.paper-review-page > * {
  width: min(100%, 920px);
}

@media (width < 768px) {
  .paper-review-page {
    gap: 40px;
    padding: 32px 24px 128px;
  }
}
</style>
