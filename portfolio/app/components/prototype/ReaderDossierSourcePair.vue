<template>
  <li
    :id="headingUnitId"
    class="reader-dossier-unit"
    :data-testid="`dossier-unit-${view.unit.id}`"
  >
    <header class="reader-dossier-unit__head">
      <span class="reader-dossier-unit__stamp">{{ view.kindLabel }}</span>
      <span v-if="view.headingLabel !== null" class="reader-dossier-unit__heading">{{ view.headingLabel }}</span>
      <span v-if="view.detailLabel === null" class="reader-dossier-unit__range">{{ view.rangeLabel }}</span>
      <template v-else>
        <span class="reader-dossier-unit__detail">{{ view.detailLabel }}</span>
        <span class="reader-dossier-unit__range">{{ view.rangeLabel }}</span>
      </template>
      <a
        v-if="pdfUrl !== null && view.unit.kind === 'caption' && view.pdfPages.length > 0"
        class="reader-dossier-unit__page-link"
        :href="pdfPageHref(view.pdfPages[0])"
        target="_blank"
        rel="noopener"
      >原文 PDF 第 {{ view.pdfPages[0] }} 页</a>
      <a
        v-else-if="pdfUrl !== null && view.unit.kind === 'preserved-original' && view.pdfPages.length > 0"
        class="reader-dossier-unit__page-link"
        :href="pdfPageHref(view.pdfPages[0])"
        target="_blank"
        rel="noopener"
      >PDF 第 {{ view.pdfPages[0] }} 页</a>
    </header>

    <p lang="en" class="reader-dossier-unit__english">{{ view.unit.original }}</p>
    <p v-if="view.chinese !== null" lang="zh" class="reader-dossier-unit__chinese">{{ view.chinese }}</p>
    <p v-else-if="view.unit.kind === 'paragraph' || view.unit.kind === 'heading' || view.unit.kind === 'caption'" class="reader-dossier-unit__missing" role="note">
      译文缺失：{{ missingUnitName(view.unit.kind) }}尚无中文译文。
    </p>
    <p v-else-if="view.unit.kind === 'excluded'" class="reader-dossier-unit__note">{{ view.detailLabel }}不翻译。</p>
    <p v-else-if="view.unit.kind === 'preserved-original'" class="reader-dossier-unit__note">图/表/公式内部内容保留原文，不翻译。</p>
    <p v-else class="reader-dossier-unit__note">该单元未被解析。</p>

    <figure
      v-if="previewSrc !== null"
      class="reader-dossier-unit__preview"
      data-testid="dossier-unit-preview"
    >
      <iframe
        class="reader-dossier-unit__preview-frame"
        data-testid="dossier-unit-preview-frame"
        :src="previewSrc"
        :title="previewIframeTitle"
        loading="lazy"
        width="760"
        height="1074"
      ></iframe>
      <figcaption class="reader-dossier-unit__preview-caption">{{ previewFigcaption }}</figcaption>
    </figure>
  </li>
</template>

<script setup lang="ts">
import type { PaperSourceUnit } from '~/utils/paper-review-task-contract'
import type { ReaderDossierUnitView } from './reader-dossier-views'

interface Props {
  readonly view: ReaderDossierUnitView
  readonly pdfUrl: string | null
}

const props = defineProps<Props>()

/** Heading units carry a stable anchor id for the B guide links. */
const headingUnitId = computed(() =>
  props.view.unit.kind === 'heading' ? `dossier-unit-${props.view.unit.id}` : undefined,
)

function missingUnitName(kind: PaperSourceUnit['kind']): string {
  switch (kind) {
    case 'heading':
      return '该标题'
    case 'caption':
      return '该图注'
    default:
      return '该段落'
  }
}

function pdfPageHref(readerPage: number): string {
  return `${props.pdfUrl ?? ''}#page=${readerPage}`
}

const previewKind = computed(() => {
  const unit = props.view.unit
  if (unit.kind === 'caption') {
    return '图注'
  }
  if (unit.kind === 'preserved-original' && unit.reason !== 'page-number') {
    return unit.reason === 'formula' ? '公式' : '表格'
  }
  return null
})

const previewSrc = computed<string | null>(() => {
  const page = props.view.previewPage
  if (page === null || props.pdfUrl === null || previewKind.value === null) {
    return null
  }
  return pdfPageHref(page)
})

const previewIframeTitle = computed(() => {
  if (props.view.previewPage === null || previewKind.value === null) {
    return ''
  }
  return `原文 PDF 第 ${props.view.previewPage} 页${previewKind.value}原始内容预览`
})

const previewFigcaption = computed(() => {
  if (props.view.previewPage === null || previewKind.value === null) {
    return ''
  }
  return `原文 PDF 第 ${props.view.previewPage} 页 · ${previewKind.value}原始内容`
})
</script>

<style scoped>
.reader-dossier-unit {
  display: grid;
  gap: 10px;
  min-inline-size: 0;
}

.reader-dossier-unit__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}

.reader-dossier-unit__stamp {
  display: inline-grid;
  flex: none;
  min-block-size: 24px;
  place-items: center;
  padding: 2px 8px;
  border: 1px solid var(--vermilion);
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1;
}

.reader-dossier-unit__detail {
  color: var(--vermilion);
  font-size: 13px;
  font-weight: 600;
}

.reader-dossier-unit__heading {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.reader-dossier-unit__range {
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}

.reader-dossier-unit__page-link {
  color: var(--vermilion);
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.reader-dossier-unit__page-link:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.reader-dossier-unit__english {
  margin: 0;
  color: var(--ink);
  font-size: 17px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.reader-dossier-unit__chinese {
  margin: 0;
  padding-inline-start: 16px;
  border-inline-start: 2px solid var(--sakura);
  color: var(--ink);
  font-size: 17px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.reader-dossier-unit__missing {
  margin: 0;
  padding: 10px 14px;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.7;
}

.reader-dossier-unit__note {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

.reader-dossier-unit__preview {
  display: grid;
  gap: 8px;
  min-inline-size: 0;
  margin: 0;
  padding-block-start: 4px;
  border-block-start: 1px dotted var(--rule);
}

.reader-dossier-unit__preview-frame {
  display: block;
  width: 100%;
  max-inline-size: 560px;
  aspect-ratio: 1 / 1.414;
  height: auto;
  border: 1px solid var(--rule);
  background-color: var(--paper-warm);
}

.reader-dossier-unit__preview-caption {
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}
</style>
