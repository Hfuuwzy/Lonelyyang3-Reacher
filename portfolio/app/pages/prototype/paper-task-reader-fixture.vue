<template>
  <PaperTaskReader :view="view" :asset-url="assetUrl" @close="handleClose" />
</template>

<script setup lang="ts">
import PaperTaskReader from '~/components/prototype/PaperTaskReader.vue'
import type { PaperTaskReaderView } from '~/utils/paper-task-reader-contract'

definePageMeta({ layout: false })
useHead({ title: '论文任务专注阅读夹具 - Lonelyyang3' })

const localePath = useLocalePath()
const fixtureMarkdown = [
  '# 可信检索：从证据片段到完整阅读',
  '',
  '本文用于检查专注阅读界面的安全渲染与交互。已有内容可阅读，缺失内容只给简短提示。',
  '',
  '## 摘要',
  '',
  '论文讨论如何在连续阅读中保留证据结构。这里包含受控图像、数学与表格。',
  '',
  '<script>alert("unsafe")' + '</' + 'script>',
  '',
  '\\<img src=x onerror=alert(1)>',
  '',
  '::dangerous[prop]',
  '',
  '[危险链接](javascript:alert(1)) 与 [安全链接](https://example.com/paper)。',
  '',
  '![受控示意图](asset:asset-fixture)',
  '',
  '| 条件 | 段落数 | 耗时 / s |',
  '| --- | ---: | ---: |',
  '| 基础 | 128 | 42.5 |',
  '| 保留结构 | 128 | 56.8 |',
  '',
  '损失 $L = L_e + \\lambda L_c$ 保持一致。',
  '',
  '$$\\sum_{i=1}^{N} x_i$$',
  '',
  '### 研究问题',
  '',
  '读者能否看见论证的全貌，而不是互不相连的逐批摘要。',
  '',
  '## 参考文献',
  '',
  '[1] Doe, A. (2026). Evidence and Continuous Reading. Synthetic Research Notes, 1(1), 1–12.',
].join('\n')

const secondMarkdown = [
  '# 深读报告：证据与限制',
  '',
  '## 主要发现',
  '',
  '论文报告了一项受控结果；分析推论需要与事实陈述区分。',
  '',
  '## 局限',
  '',
  '报告保留了未完成或未核实材料，需要人工确认。',
].join('\n')

const view: PaperTaskReaderView = {
  taskId: '123e4567-e89b-12d3-a456-426614174000',
  branches: { translation: 'preview-ready', 'deep-reading': 'needs-confirmation' },
  documents: [
    {
      branch: 'translation',
      status: 'preview',
      notice: null,
      markdown: fixtureMarkdown,
      assets: [{
        id: 'asset-fixture',
        kind: 'figure',
        caption: '受控示意图（本地夹具）',
        availability: 'available',
      }],
      formats: fixtureFormats('translation'),
    },
    {
      branch: 'deep-reading',
      status: 'needs-confirmation',
      notice: '报告保留了未完成或未核实材料；已有可读内容保留，请返回任务工作台核对原文资料。',
      markdown: secondMarkdown,
      assets: [],
      formats: fixtureFormats('deep-reading'),
    },
  ],
  pdfs: {
    original: { available: true, message: '原论文 PDF 可查看。' },
    translated: { available: false, message: '译文 PDF 尚未生成或尚未通过全页检查。' },
  },
}

function fixtureFormats(branch: 'translation' | 'deep-reading') {
  const file = (format: 'markdown' | 'assets' | 'pdf') => {
    const names = {
      markdown: branch === 'translation' ? 'translation.md' : 'deep-reading.md',
      assets: branch === 'translation' ? 'translation-assets.zip' : 'deep-reading-assets.zip',
      pdf: branch === 'translation' ? 'translated.pdf' : 'deep-reading.pdf',
    }
    return {
      status: 'unbuilt' as const, build: 'unbuilt' as const, fileName: names[format], available: false,
      inspectionAvailable: false, finalAvailable: false, pages: [], blockers: [], boundaryVerified: false,
      message: '尚未构建。',
    }
  }
  return { markdown: file('markdown'), assets: file('assets'), pdf: file('pdf') }
}

function assetUrl(assetId: string): string | null {
  return assetId === 'asset-fixture' ? '/images/brand/site-icon.png' : null
}

function handleClose(): void {
  void navigateTo(localePath('/prototype/paper-task'))
}
</script>
