<template>
  <div class="paper-reader" :data-variant="variant" data-testid="prototype-paper-reader">
    <a class="skip" href="#manuscript" :inert="drawerOpen">跳到正文</a>
    <header v-if="variant !== 'C'" class="site-head">Lonelyyang3 / 研究阅读 <small>合成阅读原型</small></header>
    <header v-if="variant === 'C'" ref="toolbar" class="focus-toolbar" :inert="drawerOpen">
      <div class="toolbar-inner">
        <div class="toolbar-left"><NuxtLink :to="localePath('/prototype/paper-review')">← 工作台</NuxtLink><button id="toc-toggle" ref="tocTrigger" type="button" :aria-expanded="drawerOpen" aria-controls="toc" @click="toggleDrawer">章节目录</button></div>
        <div class="toolbar-context"><span>全文译文</span><span v-if="titlePassed" class="short-title" title="可信检索：从证据片段到完整阅读">可信检索</span></div>
        <div class="toolbar-actions"><span class="toolbar-pdf-status" role="status" :title="pdfStatus">{{ pdfReady ? '译文 PDF' : '译文 PDF 未就绪' }}</span><button type="button" aria-label="打开译文 PDF" :disabled="!pdfReady" @click="handlePdf('translated','open')">打开</button><button type="button" aria-label="下载译文 PDF" :disabled="!pdfReady" @click="handlePdf('translated','download')">下载</button><button type="button" class="original-action" aria-label="查看原论文 PDF" @click="handlePdf('original','open')">原论文 ↗</button></div>
      </div>
    </header>
    <div class="reader-layout">
      <div id="toc" ref="toc" class="reader-toc" :class="{ open: drawerOpen }" :role="variant === 'C' ? 'dialog' : undefined" :aria-modal="variant === 'C' && drawerOpen ? true : undefined" :aria-label="variant === 'C' ? '文章章节' : undefined" :aria-hidden="variant === 'C' && !drawerOpen ? true : undefined" :inert="variant === 'C' && !drawerOpen">
        <nav aria-label="文章章节">
        <div class="toc-heading">阅读导引 <small>CONTENTS</small><button v-if="variant === 'C'" id="toc-close" ref="tocClose" type="button" @click="closeDrawer()">关闭目录</button></div>
        <div class="toc-links"><a v-for="chapter in visibleChapters" :key="chapter[0]" :href="`#section-${chapter[0]}`" :data-depth="chapter[1]" @click="closeDrawer(false)">{{ chapter[2] }}</a></div>
        </nav>
      </div>
      <main id="manuscript" tabindex="-1" :inert="drawerOpen">
        <header class="article-head"><p class="eyebrow">RESEARCH NOTES / 合成论文</p><h1 ref="articleTitle"><span class="keep-phrase">可信检索：</span><span class="keep-phrase">从证据片段</span><br v-if="variant !== 'B'" class="desktop-break"><span class="keep-phrase">到完整阅读</span></h1><p class="lede">一份用于讨论论文阅读体验的合成稿件，包含图、表、数学和附录。不是实际研究结论，也不是模型翻译成果。</p><p class="metadata">中文阅读稿 · 合成来源 12 页 · 约 8 分钟</p><p id="manuscript-status" class="manuscript-status" role="status">{{ preview ? '未完成预览 · 图 2 与附录 B 暂缺。已有内容可阅读，不能作为完整成品。' : '完整样例 · 已展示所有受控章节。此状态为模拟，不代表真实论文通过检查。' }}</p><PaperReaderDocuments v-if="variant === 'A'" :ready="pdfReady" :status="pdfStatus" @pdf="handlePdf" /></header>
        <div id="article-body" class="article-body">
          <template v-for="chapter in paperReaderChapters" :key="chapter[0]">
            <div v-if="isMissing(chapter[0])" class="missing" role="note"><strong>{{ chapter[0] === 'figure-2' ? '图 2' : '附录 B' }} 暂缺</strong>当前预览尚未包含这部分内容，请查阅原论文对应位置。<small>合成来源第 {{ chapter[4] }} 页</small></div>
            <section v-else :data-source-page="chapter[4]">
              <component :is="chapter[1] === 2 ? 'h2' : 'h3'" :id="`section-${chapter[0]}`">{{ chapter[2] }}</component><p v-if="chapter[0] === 'method'">{{ chapter[3].slice(0, -'不一致的内容。'.length) }}<span class="keep-phrase">不一致的内容。</span></p><p v-else>{{ chapter[3] }}</p><p class="source">合成来源 · 第 {{ chapter[4] }} 页</p>
              <figure v-if="chapter[5] === 'figure1' || chapter[5] === 'figure2'">
                <svg viewBox="0 0 660 290" role="img" :aria-label="chapter[5] === 'figure1' ? '图 1 合成主稿流转示意' : '图 2 合成条件对比'">
                  <template v-if="chapter[5] === 'figure1'"><g fill="none" stroke="currentColor"><rect x="35" y="70" width="155" height="105" /><rect x="250" y="70" width="155" height="105" /><rect x="465" y="70" width="155" height="105" /><path d="M190 122H250M405 122H465" /></g><g fill="currentColor" font-size="21" text-anchor="middle"><text x="112" y="130">可信原文</text><text x="327" y="130">统一主稿</text><text x="542" y="117">Markdown</text><text x="542" y="150">Word / PDF</text></g></template>
                  <template v-else><path d="M60 40V230H620" fill="none" stroke="currentColor" /><g fill="currentColor"><rect x="110" y="140" width="70" height="90" /><rect x="260" y="95" width="70" height="135" /><rect x="410" y="65" width="70" height="165" /></g><g fill="currentColor" font-size="16"><text x="110" y="258">条件 A</text><text x="260" y="258">条件 B</text><text x="410" y="258">条件 C</text></g></template>
                </svg><figcaption>{{ chapter[5] === 'figure1' ? '图 1 · 共享主稿的流转示意（合成图）' : '图 2 · 合成条件对比（虚构数据）' }}</figcaption>
              </figure>
              <div v-if="chapter[5] === 'table'" class="table-scroll"><table><caption>表 1 · 合成样例，非真实实验数据</caption><thead><tr><th scope="col">条件</th><th scope="col">段落数</th><th scope="col">图表数</th><th scope="col">模拟耗时 / s</th></tr></thead><tbody><tr><th scope="row">基础</th><td>128</td><td>6</td><td>42.5</td></tr><tr><th scope="row">保留结构</th><td>128</td><td>6</td><td>56.8</td></tr><tr><th scope="row">全文整合</th><td>128</td><td>6</td><td>71.2</td></tr></tbody></table></div>
              <template v-if="chapter[5] === 'math'"><p>可将合成示例写为 <math aria-label="L 等于 L evidence 加 lambda L coverage"><mi>L</mi><mo>=</mo><msub><mi>L</mi><mi>evidence</mi></msub><mo>+</mo><mi>λ</mi><msub><mi>L</mi><mi>coverage</mi></msub></math>。式 1 则示范块级求和：</p><div class="equation"><math display="block" aria-label="J theta 等于一除以 N 乘以损失求和"><mrow><mi>J</mi><mo>(</mo><mi>θ</mi><mo>)</mo></mrow><mo>=</mo><mfrac><mn>1</mn><mi>N</mi></mfrac><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover><mrow><msub><mi>ℓ</mi><mi>i</mi></msub><mo>(</mo><mi>θ</mi><mo>)</mo></mrow></math></div><p class="caption">式 1 · 仅作数学排版样例，不描述真实算法</p></template>
              <div v-if="chapter[5] === 'references'" class="bibliography"><p>[1] Doe, A. (2026). Evidence and Continuous Reading. Synthetic Research Notes, 1(1), 1–12. [Fictional fixture]</p><p>[2] Roe, B. &amp; Doe, C. (2026). A Shared Manuscript for Three Document Formats. Imaginary Proceedings on Document Interfaces. [Fictional fixture]</p></div>
            </section>
          </template>
        </div>
        <footer class="article-footer">到这里，阅读告一段落。<small>所有数据、来源页码和 PDF 均为本地合成夹具，不构成研究证据。</small></footer>
      </main>
      <PaperReaderDocuments v-if="variant === 'B'" class="documents-rail" :ready="pdfReady" :status="pdfStatus" @pdf="handlePdf" />
    </div>
    <button v-if="drawerOpen && variant === 'C'" class="drawer-backdrop" type="button" tabindex="-1" aria-label="关闭章节目录" @click="closeDrawer()" />
    <section class="fixture-controls" aria-label="原型状态控制" :inert="drawerOpen"><div><label for="content-state">模拟稿件</label><select id="content-state" v-model="contentState"><option value="preview">未完成预览</option><option value="complete">完整样例</option></select></div><div><label for="pdf-state">模拟译文 PDF</label><select id="pdf-state" v-model="pdfState" :disabled="preview"><option value="unavailable">未就绪</option><option value="ready">已就绪</option></select></div><p>状态为模拟，不代表实际验收通过。PDF 仅为入口验证夹具。</p></section>
    <nav class="switcher" aria-label="布局切换" :inert="drawerOpen"><button type="button" aria-label="上一个布局" @click="cycle(-1)">←</button><button v-for="choice in variants" :key="choice" type="button" :data-variant="choice" :aria-pressed="variant === choice" @click="chooseVariant(choice)">{{ variantLabels[choice] }}</button><button type="button" aria-label="下一个布局" @click="cycle(1)">→</button></nav>
  </div>
</template>

<script setup lang="ts">
import PaperReaderDocuments from '~/components/prototype/PaperReaderDocuments.vue'
import { createPaperReaderPdf, paperReaderChapters } from '~/components/prototype/paper-reader-fixture'
import type { PaperReaderPdfAction, PaperReaderPdfKind } from '~/components/prototype/paper-reader-fixture'

definePageMeta({ layout: false })
useHead({ title: '论文阅读排版原型 - Lonelyyang3' })
const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const variants = ['A', 'B', 'C'] as const
type Variant = typeof variants[number]
const variantLabels = { A: 'A 文章导读', B: 'B 三栏阅读', C: 'C 专注阅读' } as const
const variant = computed<Variant>(() => route.query.variant === 'A' || route.query.variant === 'B' ? route.query.variant : 'C')
const contentState = ref<'preview' | 'complete'>('preview')
const pdfState = ref<'unavailable' | 'ready'>('unavailable')
const preview = computed(() => contentState.value === 'preview')
const pdfReady = computed(() => !preview.value && pdfState.value === 'ready')
const pdfStatus = computed(() => pdfReady.value ? '译文 PDF 样例已就绪。' : preview.value ? '译文 PDF 未就绪：主稿仍有缺失。' : '译文 PDF 未就绪：文档生成或检查尚未完成。')
function isMissing(id: string): boolean { return preview.value && (id === 'figure-2' || id === 'appendix-b') }
const visibleChapters = computed(() => paperReaderChapters.filter(chapter => !isMissing(chapter[0])))
watch(preview, value => { if (value) pdfState.value = 'unavailable' })
const drawerOpen = ref(false)
const toc = ref<HTMLElement | null>(null)
const tocTrigger = ref<HTMLButtonElement | null>(null)
const tocClose = ref<HTMLButtonElement | null>(null)
const toolbar = ref<HTMLElement | null>(null)
const articleTitle = ref<HTMLElement | null>(null)
const titlePassed = ref(false)
let titleObserver: IntersectionObserver | undefined
let toolbarObserver: ResizeObserver | undefined
const pdfUrls = new Map<PaperReaderPdfKind, string>()

function revokePdfs(): void { pdfUrls.forEach(url => URL.revokeObjectURL(url)); pdfUrls.clear() }
function handlePdf(kind: PaperReaderPdfKind, action: PaperReaderPdfAction): void {
  if (kind === 'translated' && !pdfReady.value) return
  let url = pdfUrls.get(kind)
  if (!url) { url = URL.createObjectURL(createPaperReaderPdf(kind)); pdfUrls.set(kind, url) }
  const link = document.createElement('a')
  link.href = url
  if (action === 'download') link.download = `${kind}-synthetic-fixture.pdf`
  else { link.target = '_blank'; link.rel = 'noopener' }
  document.body.append(link); link.click(); link.remove()
}
function handlePageHide(event: PageTransitionEvent): void { if (!event.persisted) revokePdfs() }
function closeDrawer(restore = true): void {
  const wasOpen = drawerOpen.value
  drawerOpen.value = false
  if (wasOpen && restore) void nextTick(() => tocTrigger.value?.focus({ preventScroll: true }))
}
async function toggleDrawer(): Promise<void> {
  if (drawerOpen.value) { closeDrawer(); return }
  drawerOpen.value = true
  await nextTick()
  tocClose.value?.focus({ preventScroll: true })
}
async function chooseVariant(value: Variant): Promise<void> {
  closeDrawer(false)
  await router.replace({ path: route.path, query: { ...route.query, variant: value }, hash: route.hash })
}
function cycle(step: number): void {
  const choice = variants[(variants.indexOf(variant.value) + step + variants.length) % variants.length]
  if (choice) void chooseVariant(choice)
}
function handleKeys(event: KeyboardEvent): void {
  if (drawerOpen.value) {
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer() }
    if (event.key === 'Tab') {
      const links = toc.value?.querySelectorAll<HTMLElement>('button,a')
      const first = links?.[0], last = links?.[links.length - 1]
      if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    return
  }
  if (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable]')) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1) }
}
function observeTitle(): void {
  titleObserver?.disconnect()
  const title = articleTitle.value
  if (!title) return
  const height = toolbar.value?.getBoundingClientRect().height ?? 0
  titleObserver = new IntersectionObserver(entries => {
    const entry = entries[0]
    if (entry) titlePassed.value = entry.boundingClientRect.bottom <= height
  }, { rootMargin: `-${height}px 0px 0px 0px`, threshold: [0, 1] })
  titleObserver.observe(title)
}
function observeToolbar(): void {
  toolbarObserver?.disconnect()
  observeTitle()
  if (toolbar.value) { toolbarObserver = new ResizeObserver(observeTitle); toolbarObserver.observe(toolbar.value) }
}
watch(variant, async () => { closeDrawer(false); await nextTick(); observeToolbar() })
onMounted(() => {
  observeToolbar()
  window.addEventListener('keydown', handleKeys)
  window.addEventListener('pagehide', handlePageHide)
})
onBeforeUnmount(() => {
  titleObserver?.disconnect(); toolbarObserver?.disconnect(); revokePdfs()
  window.removeEventListener('keydown', handleKeys)
  window.removeEventListener('pagehide', handlePageHide)
})
</script>

<style scoped src="~/components/prototype/paper-reader.css"></style>
