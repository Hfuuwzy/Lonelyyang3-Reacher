<template>
  <aside class="reader-documents" aria-label="文档入口">
    <p class="eyebrow">DOCUMENTS</p><h2>阅读与带走</h2><p role="status">{{ status }}</p>
    <div class="document-group"><h3>译文 PDF</h3>
      <button type="button" :disabled="!ready" @click="emit('pdf', 'translated', 'open')">打开译文 PDF</button>
      <button type="button" :disabled="!ready" @click="emit('pdf', 'translated', 'download')">下载译文 PDF</button>
    </div>
    <div class="document-group original"><h3>原论文</h3>
      <button type="button" @click="emit('pdf', 'original', 'open')">查看原论文 PDF</button>
      <button type="button" @click="emit('pdf', 'original', 'download')">下载原论文样例</button>
    </div>
    <p class="document-note">两个文件均为不同身份的合成夹具，不是实际论文或译文。</p>
  </aside>
</template>
<script setup lang="ts">
import type { PaperReaderPdfAction, PaperReaderPdfKind } from './paper-reader-fixture'
defineProps<{ readonly ready: boolean; readonly status: string }>()
const emit = defineEmits<{ pdf: [kind: PaperReaderPdfKind, action: PaperReaderPdfAction] }>()
</script>
<style scoped>
.reader-documents { border-top:1px solid var(--rule); padding-top:24px; margin:28px 0; font-size:14px; }
.reader-documents h2 { font-size:22px; margin-bottom:16px; }
.reader-documents h3 { font-size:15px; margin:0 0 12px; }
.reader-documents p { color:var(--ink-soft); line-height:1.8; }
.eyebrow { letter-spacing:.2em; font-size:12px; margin-bottom:20px; }
.document-group { display:inline-block; vertical-align:top; margin:16px 20px 0 0; }
button { min-height:44px; padding:8px 12px; border:1px solid var(--rule); margin:0 6px 8px 0; }
button:hover:enabled { background:color-mix(in srgb,var(--ink) 5%,transparent); }
button:disabled { opacity:.45; cursor:not-allowed; }
button:focus-visible { outline:2px solid var(--vermilion); outline-offset:3px; }
.original button { border-color:transparent; text-decoration:underline; text-underline-offset:5px; }
.document-note { font-size:12px; margin-top:14px; }
</style>
