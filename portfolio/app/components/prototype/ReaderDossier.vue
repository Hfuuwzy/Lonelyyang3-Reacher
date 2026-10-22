<template>
  <div class="reader-dossier" data-testid="reader-dossier">
    <!-- 任务状态：与下方「核验状态」相互独立。 -->
    <section
      class="reader-dossier__task"
      data-testid="dossier-task-status"
      aria-labelledby="dossier-task-title"
    >
      <h3 id="dossier-task-title" class="reader-dossier__section-title">任务状态</h3>
      <p class="reader-dossier__task-status" :data-status="dossier.status" role="status">
        {{ taskStatusLine }}
      </p>
      <p class="reader-dossier__task-note">
        完成与否描述报告、译文与原文核验是否全部就绪；与下方「核验状态」相互独立，后者为模型对照复检，不构成语义正确性保证。
      </p>
    </section>

    <!-- 深读报告：复用 #27 报告结构，供既有验收选择器继续引用。 -->
    <PrototypeReaderDossierReport :dossier="dossier" />

    <!-- 译文对照：按源文档顺序逐单元呈现，标题/段落/图注提供英中对；排除与保留单元只作标记。 -->
    <section
      id="dossier-translation"
      class="reader-dossier__translation"
      data-testid="dossier-translation"
      aria-labelledby="dossier-translation-title"
    >
      <h3 id="dossier-translation-title" class="reader-dossier__section-title">译文对照</h3>
      <p class="reader-dossier__translation-note">
        范围内标题、正文段落与可译图注按源文档顺序逐单元呈现英文原文与中文译文；参考文献、附录不翻译，图表内部内容保留原文。
      </p>

      <ol class="reader-dossier__units">
        <PrototypeReaderDossierSourcePair
          v-for="view in unitViews"
          :key="view.unit.id"
          :view="view"
          :pdf-url="pdfUrl"
        />
      </ol>

      <p v-if="exclusionScopeText !== ''" class="reader-dossier__exclusion-scope" data-testid="dossier-exclusion-scope">
        {{ exclusionScopeText }}
      </p>
    </section>

    <!-- 核验状态：模型比对，与任务完成状态区分。 -->
    <PrototypeReaderDossierReview :review="dossier.translation.review" />

    <!-- 未覆盖范围：应用持有的受影响单元/页码/范围。 -->
    <PrototypeReaderDossierGaps :gaps="dossier.gaps" :units="dossier.source.units" />
  </div>
</template>

<script setup lang="ts">
import type { PaperReviewTaskResult } from '~/utils/paper-review-task-contract'
import { readerExclusionScopeText } from './reader-dossier-labels'
import { readerDossierUnitViews } from './reader-dossier-views'

interface Props {
  readonly dossier: PaperReviewTaskResult
  readonly pdfUrl: string | null
}

const props = defineProps<Props>()

const unitViews = computed(() =>
  readerDossierUnitViews(props.dossier.source.units, props.dossier.translation.pairs),
)

const exclusionScopeText = computed(() => readerExclusionScopeText(props.dossier.source.units))

const taskStatusLine = computed(() => {
  if (props.dossier.status === 'complete') {
    return '任务完成：报告、译文与原文核验均已就绪。'
  }
  return '任务不完整：报告、译文或原文核验尚未全部就绪。'
})
</script>

<style scoped>
.reader-dossier {
  display: grid;
  gap: 56px;
  font-family: "Noto Serif SC", "Noto Serif JP", "Songti SC", serif;
  font-weight: 400;
}

.reader-dossier__section-title {
  margin: 0;
  color: var(--ink);
  font: 700 20px/1.4 var(--font-mincho);
}

/* —— 任务状态 —— */
.reader-dossier__task {
  display: grid;
  gap: 10px;
  padding-block-start: 28px;
  border-block-start: 1px dotted var(--rule);
}

.reader-dossier__task-status {
  margin: 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.7;
}

.reader-dossier__task-status[data-status='complete'] {
  color: var(--ink);
}

.reader-dossier__task-status[data-status='incomplete'] {
  color: var(--vermilion);
}

.reader-dossier__task-note {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

/* —— 译文对照 —— */
.reader-dossier__translation {
  display: grid;
  gap: 16px;
  padding-block-start: 28px;
  border-block-start: 1px dotted var(--rule);
}

.reader-dossier__translation-note {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

.reader-dossier__units {
  display: grid;
  gap: 28px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reader-dossier__exclusion-scope {
  margin: 0;
  padding-block-start: 16px;
  border-block-start: 1px dotted var(--rule);
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}
</style>