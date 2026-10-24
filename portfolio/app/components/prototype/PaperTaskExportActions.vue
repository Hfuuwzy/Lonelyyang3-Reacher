<template>
  <section class="paper-task-exports" aria-labelledby="paper-task-exports-title">
    <div class="paper-task-exports__heading">
      <div>
        <p class="paper-task-exports__eyebrow">DELIVERABLES</p>
        <h2 id="paper-task-exports-title">导出当前成果</h2>
      </div>
      <p>仅处理当前分支。构建不会自动下载或分享；译文 PDF 最终入口需先完成逐页检查。</p>
    </div>

    <div class="paper-task-exports__formats" aria-label="格式状态">
      <article v-for="format in visibleFormats" :key="format" class="paper-task-exports__format">
        <div class="paper-task-exports__format-copy">
          <h3>{{ labels[format] }}</h3>
          <p role="status" :data-status="document.formats[format].status">{{ document.formats[format].message }}</p>
          <p v-if="document.formats[format].blockers.length > 0" class="paper-task-exports__blockers">
            {{ document.formats[format].blockers.join('；') }}
          </p>
          <details v-if="document.formats[format].pages.length > 0" class="paper-task-exports__evidence">
            <summary>查看逐页检查记录（{{ document.formats[format].pages.length }} 页）</summary>
            <ol>
              <li v-for="page in document.formats[format].pages" :key="page.page">
                <strong>第 {{ page.page }} 页 · {{ pageStatusLabel(page.status) }}</strong>
                <dl>
                  <dt>预期可见内容</dt>
                  <dd>{{ page.expected }}</dd>
                  <dt>实际观察</dt>
                  <dd>{{ page.observed }}</dd>
                  <dt>检查证据</dt>
                  <dd>{{ page.evidence }}</dd>
                  <template v-if="page.reason">
                    <dt>备注</dt>
                    <dd>{{ page.reason }}</dd>
                  </template>
                </dl>
              </li>
            </ol>
          </details>
        </div>
        <div class="paper-task-exports__actions">
          <button
            v-if="!document.formats[format].available || document.formats[format].status === 'failed'"
            type="button"
            :disabled="pending !== null"
            @click="build(format)"
          >
            {{ pending === format ? '正在构建…' : buildLabels[format] }}
          </button>
          <button
            v-if="document.formats[format].available && (format === 'markdown' || format === 'assets')"
            type="button"
            :disabled="pending !== null"
            @click="retrieve(format, true)"
          >
            {{ format === 'markdown' ? '下载 Markdown' : '下载受控资产包' }}
          </button>
          <button
            v-if="format === 'pdf' && document.formats.pdf.inspectionAvailable && !document.formats.pdf.finalAvailable"
            type="button"
            :disabled="pending !== null"
            @click="beginInspection('pdf')"
          >
            检查生成的 PDF
          </button>
          <button
            v-if="format === 'pdf' && document.formats.pdf.finalAvailable"
            type="button"
            :disabled="pending !== null"
            @click="retrieve('pdf', true)"
          >
            下载最终 PDF
          </button>
        </div>
      </article>
    </div>

    <p v-if="errorMessage !== ''" class="paper-task-exports__error" role="alert">{{ errorMessage }}</p>

    <form v-if="inspectionFormat !== null" class="paper-task-exports__inspection" @submit.prevent="submitInspection">
      <header>
        <div>
          <p class="paper-task-exports__eyebrow">PAGE-BY-PAGE REVIEW</p>
          <h3>译文 PDF 全页检查</h3>
        </div>
        <button type="button" class="paper-task-exports__close" @click="inspectionFormat = null">关闭检查表</button>
      </header>

      <p v-if="inspectionFormat === 'pdf'" class="paper-task-exports__instruction">
        检查区显示本次生成的实际 PDF。逐页选择页码，核对文字、图表、说明与边界；内容缺失、遮挡、截断或关键裁切必须标为“阻止发布”。
      </p>
      <div class="paper-task-exports__pdf-review">
        <label for="paper-task-review-page">当前 PDF 检查页</label>
        <select id="paper-task-review-page" v-model.number="activePage">
          <option v-for="page in pageDrafts" :key="page.page" :value="page.page">第 {{ page.page }} 页</option>
        </select>
        <iframe
          :key="activePage"
          :src="pdfInspectionUrl(activePage)"
          :title="`译文 PDF 第 ${activePage} 页检查预览`"
          loading="lazy"
        />
      </div>

      <div class="paper-task-exports__page-list">
        <fieldset v-for="page in pageDrafts" :key="page.page" class="paper-task-exports__page">
          <legend>第 {{ page.page }} 页</legend>
          <label>
            预期可见内容
            <input v-model="page.expected" type="text" maxlength="500" required>
          </label>
          <label>
            实际观察
            <textarea v-model="page.observed" rows="2" maxlength="500" required />
          </label>
          <label>
            检查证据 / 观察记录
            <textarea v-model="page.evidence" rows="2" maxlength="500" required />
          </label>
          <label>
            页面结论
            <select v-model="page.status" required>
              <option value="" disabled>请选择页面结论</option>
              <option value="passed">通过</option>
              <option value="minor">轻微留白或换行瑕疵</option>
              <option value="blocked">阻止发布：缺失、遮挡、截断或裁切</option>
            </select>
          </label>
        </fieldset>
      </div>

      <div class="paper-task-exports__inspection-actions">
        <button type="submit" :disabled="pending !== null || pageDrafts.length === 0">
          {{ pending === 'inspection' ? '正在保存…' : '保存所有页面检查记录' }}
        </button>
        <p>只在所有页均有实际检查记录且没有阻断项时，格式状态才会开放最终文件。</p>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PaperTaskReaderDocument, PaperTaskReaderView } from '~/utils/paper-task-reader-contract'
import { createPaperTaskInspectionDrafts, type PaperTaskInspectionPageDraft } from '~/utils/paper-task-export-inspection'
import {
  PAPER_TASK_EXPORT_FORMATS,
  paperTaskArtifactInspectionPath,
  paperTaskArtifactPath,
  paperTaskArtifactsPath,
  projectPaperTaskReaderView,
  type PaperTaskExportFormat,
} from '~/utils/paper-task-reader-contract'

const props = defineProps<{ readonly taskId: string; readonly document: PaperTaskReaderDocument }>()
const emit = defineEmits<{ readonly updated: [view: PaperTaskReaderView] }>()

const labels: Record<PaperTaskExportFormat, string> = {
  markdown: 'Markdown 主稿', assets: '受控原图资产', pdf: '译文 PDF（检查与最终）',
}
const buildLabels: Record<PaperTaskExportFormat, string> = {
  markdown: '构建 Markdown', assets: '整理资产包', pdf: '生成逐页检查副本',
}
const visibleFormats = computed(() => props.document.branch === 'translation'
  ? PAPER_TASK_EXPORT_FORMATS
  : ['markdown', 'assets'] as const)
const pending = ref<PaperTaskExportFormat | 'inspection' | null>(null)
const errorMessage = ref('')
const inspectionFormat = ref<'pdf' | null>(null)
const inspectionArtifactSha256 = ref<string | null>(null)
const expectedPageCount = ref(0)
const activePage = ref(1)
const pageDrafts = ref<PaperTaskInspectionPageDraft[]>([])


async function build(format: PaperTaskExportFormat): Promise<void> {
  pending.value = format
  errorMessage.value = ''
  try {
    const payload = await $fetch<unknown>(paperTaskArtifactsPath(props.taskId), {
      method: 'POST', credentials: 'omit', retry: 0,
      body: { branch: props.document.branch, formats: [format] },
    })
    const view = projectPaperTaskReaderView(payload, props.taskId)
    if (view === null) throw new Error('服务器返回的成果状态不符合任务格式。')
    emit('updated', view)
  } catch (error) {
    errorMessage.value = requestMessage(error)
  } finally {
    pending.value = null
  }
}

function retrieve(format: PaperTaskExportFormat, download: boolean): void {
  const link = document.createElement('a')
  link.href = paperTaskArtifactPath(props.taskId, props.document.branch, format, { download })
  link.download = props.document.formats[format].fileName
  if (format === 'pdf' && !download) { link.target = '_blank'; link.rel = 'noopener' }
  document.body.append(link)
  link.click()
  link.remove()
}

function beginInspection(format: 'pdf'): void {
  const artifactSha256 = props.document.formats[format].artifactSha256
  if (artifactSha256 === undefined) {
    errorMessage.value = '当前 PDF 缺少可验证的文件标识，请重新构建后再检查。'
    return
  }
  inspectionArtifactSha256.value = artifactSha256
  inspectionFormat.value = format
  initializePages(format)
}

function initializePages(format: 'pdf'): void {
  const saved = props.document.formats[format]
  const count = saved.expectedPageCount ?? saved.pages.length
  expectedPageCount.value = count
  pageDrafts.value = createPaperTaskInspectionDrafts(count, saved.pages)
  activePage.value = Math.min(Math.max(activePage.value, 1), Math.max(count, 1))
}

function pdfInspectionUrl(page: number): string {
  const artifactSha256 = inspectionArtifactSha256.value
  return `${paperTaskArtifactPath(props.taskId, 'translation', 'pdf', {
    inspection: true,
    ...(artifactSha256 === null ? {} : { artifactSha256 }),
  })}#page=${page}`
}

function pageStatusLabel(status: 'passed' | 'minor' | 'blocked'): string {
  if (status === 'blocked') return '阻止发布'
  if (status === 'minor') return '轻微瑕疵'
  return '通过'
}

async function submitInspection(): Promise<void> {
  const format = inspectionFormat.value
  const artifactSha256 = inspectionArtifactSha256.value
  if (format === null || artifactSha256 === null) return
  pending.value = 'inspection'
  errorMessage.value = ''
  try {
    const payload = await $fetch<unknown>(paperTaskArtifactInspectionPath(props.taskId, 'translation', format), {
      method: 'POST', credentials: 'omit', retry: 0,
      body: { artifactSha256, expectedPageCount: expectedPageCount.value, pages: pageDrafts.value },
    })
    const view = projectPaperTaskReaderView(payload, props.taskId)
    if (view === null) throw new Error('服务器返回的检查状态不符合任务格式。')
    emit('updated', view)
    inspectionFormat.value = null
    inspectionArtifactSha256.value = null
  } catch (error) {
    errorMessage.value = requestMessage(error)
  } finally {
    pending.value = null
  }
}

function requestMessage(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data !== null && typeof data === 'object' && 'message' in data && typeof data.message === 'string') return data.message
  }
  return '操作未完成。请确认当前任务仍可读取后重试。'
}
</script>

<style scoped>
.paper-task-exports {
  margin-block: 32px 44px;
  padding-block: 22px;
  border-block: 1px solid var(--rule);
  font-size: 14px;
}

.paper-task-exports__heading,
.paper-task-exports__inspection > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.paper-task-exports__heading h2,
.paper-task-exports__inspection h3 {
  margin: 0;
  font-size: 21px;
}

.paper-task-exports__heading > p,
.paper-task-exports__instruction,
.paper-task-exports__inspection-actions > p {
  max-inline-size: 52ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.7;
}

.paper-task-exports__eyebrow {
  margin: 0 0 8px;
  color: var(--ink-soft);
  font-size: 11px;
  letter-spacing: 0.18em;
}

.paper-task-exports__formats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-block-start: 22px;
}

.paper-task-exports__format,
.paper-task-exports__page {
  min-inline-size: 0;
  padding: 16px;
  border: 1px solid var(--rule);
}

.paper-task-exports__format h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.paper-task-exports__format p {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.65;
}

.paper-task-exports__format [data-status='complete'] { color: var(--ink); }
.paper-task-exports__format [data-status='failed'] { color: var(--vermilion); }
.paper-task-exports__blockers { margin-block-start: 8px !important; font-size: 12px; }
.paper-task-exports__evidence { margin-block-start: 12px; border-block-start: 1px solid var(--rule); padding-block-start: 10px; }
.paper-task-exports__evidence summary { min-block-size: 40px; cursor: pointer; font-weight: 600; }
.paper-task-exports__evidence ol { margin: 8px 0 0; padding-inline-start: 22px; }
.paper-task-exports__evidence li + li { margin-block-start: 12px; }
.paper-task-exports__evidence dl { display: grid; grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr); gap: 4px 10px; margin: 8px 0 0; line-height: 1.6; }
.paper-task-exports__evidence dt { color: var(--ink-soft); }
.paper-task-exports__evidence dd { min-inline-size: 0; margin: 0; overflow-wrap: anywhere; }

.paper-task-exports__actions,
.paper-task-exports__inspection-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-block-start: 14px;
}

.paper-task-exports__error {
  margin-block: 14px 0;
  color: var(--vermilion);
}

.paper-task-exports__inspection {
  display: grid;
  gap: 18px;
  margin-block-start: 26px;
  padding: 20px;
  border: 1px solid var(--rule);
  background: var(--paper-task-reader-wash);
}

.paper-task-exports__close { white-space: nowrap; }
.paper-task-exports__pdf-review { display: grid; gap: 10px; }
.paper-task-exports__pdf-review iframe { inline-size: 100%; block-size: min(65vh, 760px); border: 1px solid var(--rule); background: var(--paper); }

.paper-task-exports__page-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.paper-task-exports__page legend { padding-inline: 6px; font-weight: 700; }
.paper-task-exports__page label { display: grid; gap: 6px; margin-block-start: 12px; }
.paper-task-exports__page :where(input, textarea, select),
.paper-task-exports__pdf-review select {
  min-block-size: 44px;
  inline-size: 100%;
  padding: 8px 10px;
  border: 1px solid var(--rule);
  border-radius: 0;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
}
.paper-task-exports__page textarea { resize: vertical; }
.paper-task-exports__inspection-actions { justify-content: space-between; }

@media (width < 760px) {
  .paper-task-exports__heading { display: grid; }
  .paper-task-exports__formats,
  .paper-task-exports__page-list { grid-template-columns: minmax(0, 1fr); }
  .paper-task-exports__inspection { padding: 14px; }
  .paper-task-exports__inspection > header { flex-wrap: wrap; }
}
</style>
