<template>
  <div data-testid="home-agent-guide" class="agent-guide" :inert="!active">
    <p class="agent-guide__eyebrow">AGENT GUIDE <span>这里也有工具可用</span></p>
    <a class="agent-guide__entry" href="#tools">
      <span class="agent-guide__index">01 / 论文阅读</span>
      <strong>一篇论文，两种读法。</strong>
      <span class="agent-guide__description">译成中文，或先读懂思路。<br>在独立工作台提交论文，继续完整阅读。</span>
      <span class="agent-guide__path">PDF / arXiv <span aria-hidden="true">→</span> 翻译 · 深读</span>
      <span class="agent-guide__action">了解论文智能体 <span aria-hidden="true">↗</span></span>
    </a>
  </div>
</template>

<script setup lang="ts">
defineProps<{ active: boolean }>()
</script>

<style scoped>
.agent-guide {
  position: relative;
  padding: 24px 30px 18px;
  border-block: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
  background: color-mix(in srgb, var(--paper-warm) 24%, transparent);
}

.agent-guide::before,
.agent-guide::after {
  position: absolute;
  inline-size: 20px;
  block-size: 20px;
  border-color: var(--paper-warm);
  border-style: solid;
  pointer-events: none;
  content: '';
}

.agent-guide::before {
  inset: -4px auto auto -4px;
  border-width: 3px 0 0 3px;
}

.agent-guide::after {
  inset: auto -4px -4px auto;
  border-width: 0 3px 3px 0;
}

.agent-guide__eyebrow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--ink-soft);
  font-size: 11px;
  letter-spacing: 0.24em;
}

.agent-guide__eyebrow > span {
  letter-spacing: 0.05em;
}

.agent-guide__entry {
  display: grid;
  gap: 10px;
  margin-block-start: 18px;
  color: var(--ink);
  text-decoration: none;
}

.agent-guide__index {
  color: var(--ink-soft);
  font-size: 13px;
  letter-spacing: 0.1em;
}

.agent-guide__entry strong {
  font-size: clamp(20px, 1.1vw, 28px);
  font-weight: 500;
  letter-spacing: 0.04em;
  text-wrap: balance;
}

.agent-guide__description {
  font-size: clamp(15px, 0.7vw, 18px);
  line-height: 1.9;
}

.agent-guide__path {
  color: var(--ink-soft);
  font-size: 13px;
  letter-spacing: 0.08em;
}

.agent-guide__path > span {
  margin-inline: 16px;
}

.agent-guide__action {
  display: flex;
  min-block-size: 44px;
  align-items: center;
  justify-content: space-between;
  margin-block-start: 6px;
  border-block-start: 1px dotted var(--rule);
  font-size: 16px;
}

.agent-guide__entry:hover .agent-guide__action {
  color: var(--vermilion);
}

.agent-guide__entry:focus-visible {
  outline: 2px solid var(--vermilion);
  outline-offset: 7px;
}

@media (width < 1280px) {
  .agent-guide {
    padding: 18px;
  }

  .agent-guide__eyebrow {
    display: block;
    line-height: 1.8;
  }

  .agent-guide__eyebrow > span {
    display: block;
  }
}
</style>
