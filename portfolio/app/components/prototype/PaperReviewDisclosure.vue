<template>
  <aside class="paper-review-disclosure" aria-labelledby="paper-review-disclosure-title">
    <p class="paper-review-disclosure__eyebrow">DISCLOSURE</p>
    <h3 id="paper-review-disclosure-title" class="paper-review-disclosure__title">提供方 · 协议 · 数据 · 费用</h3>
    <dl class="paper-review-disclosure__list">
      <div class="paper-review-disclosure__item">
        <dt>提供方</dt>
        <dd>审阅调用由你填写的提供方（{{ providerLabel || '未填写' }}）提供；模型端点与计费主体由你选择并负责。</dd>
      </div>
      <div class="paper-review-disclosure__item">
        <dt>协议</dt>
        <dd>请求按你选择的协议（{{ protocolLabel }}）构造，请与提供方文档核对路径与载荷惯例。</dd>
      </div>
      <div class="paper-review-disclosure__item">
        <dt>数据</dt>
        <dd>原始 PDF 由本地开发服务器解析，仅提取出的页面文本与审阅上下文发送至你填写的 Base URL（{{ baseUrl || '未填写' }}）。提交数据的留存与删除以提供方自身条款为准。</dd>
      </div>
      <div class="paper-review-disclosure__item">
        <dt>凭证与临时会话</dt>
        <dd>密钥仅保存在当前页面内存、本次请求与单个子进程环境中，绝不写入 URL、Cookie、浏览器存储、日志或后续任务。每次运行的临时 Harness 会话数据在成功或失败后均被移除，本站不保留长期研究历史。</dd>
      </div>
      <div class="paper-review-disclosure__item">
        <dt>费用</dt>
        <dd>API 调用费用由你直接向提供方结算，本站不代收、不垫付；费率以提供方当前定价为准。</dd>
      </div>
    </dl>
  </aside>
</template>

<script setup lang="ts">
interface Props {
  readonly providerLabel: string
  readonly baseUrl: string
  readonly protocolLabel: string
}

defineProps<Props>()
</script>

<style scoped>
.paper-review-disclosure {
  display: grid;
  gap: 14px;
  padding-block-end: 28px;
  border-block-end: 1px dotted var(--rule);
}

.paper-review-disclosure__eyebrow {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
  text-transform: uppercase;
}

.paper-review-disclosure__title {
  margin: 0;
  color: var(--ink);
  font: 600 clamp(20px, 3vw, 28px)/1.4 var(--font-mincho);
}

.paper-review-disclosure__list {
  display: grid;
  gap: 12px;
  margin: 0;
}

.paper-review-disclosure__item {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  margin: 0;
}

.paper-review-disclosure__item dt {
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
}

.paper-review-disclosure__item dd {
  margin: 0;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.8;
}

@media (width < 640px) {
  .paper-review-disclosure__item {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
}
</style>
