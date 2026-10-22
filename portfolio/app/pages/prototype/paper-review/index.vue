<template>
  <PaperReviewPageShell
    stamp="原型"
    english="PAPER REVIEW"
    title="论文研究审阅工作台"
    description="单篇 PDF 的本地研究审阅原型：本地抽文与版式解析，随后由你自带的模型端点完成分析、译文与原文核验。仅通过开发服务器提供，不属于生产站点内容。"
  >
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

    <PaperReviewError v-if="errorMessage !== ''" :message="errorMessage" />

    <PaperReviewSummary
      v-if="phase === 'result' && result !== null"
      :result="result"
      :pdf-name="pdfName"
      :pdf-url="pdfUrl"
    />
  </PaperReviewPageShell>
</template>

<script setup lang="ts">
import PaperReviewDisclosure from '~/components/prototype/PaperReviewDisclosure.vue'
import PaperReviewError from '~/components/prototype/PaperReviewError.vue'
import PaperReviewForm from '~/components/prototype/PaperReviewForm.vue'
import PaperReviewProgress from '~/components/prototype/PaperReviewProgress.vue'
import PaperReviewPageShell from '~/components/prototype/PaperReviewPageShell.vue'
import PaperReviewSummary from '~/components/prototype/PaperReviewSummary.vue'
import { usePaperReviewSession } from '~/composables/paper-review-session'
import { usePaperReviewWorkbench } from '~/composables/paper-review-workbench'

// The session is provided by the parent route; the workbench logic (form
// state, credentials, in-flight request, adoption) stays child-local.
const session = usePaperReviewSession()
const {
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
} = usePaperReviewWorkbench(session)
</script>