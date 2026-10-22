<template>
  <section
    data-testid="paper-review-error"
    class="paper-review-error"
    role="alert"
    aria-labelledby="paper-review-error-title"
  >
    <p id="paper-review-error-title" class="paper-review-error__title">本次审阅未能完成</p>
    <p class="paper-review-error__body">{{ message }}</p>
    <p class="paper-review-error__hint">本次失败不会自动重试；请检查本地审阅端点与提供方配置后，重新输入 API 密钥再次提交。</p>
  </section>
</template>

<script setup lang="ts">
interface Props {
  readonly message: string
}

defineProps<Props>()
</script>

<style scoped>
.paper-review-error {
  display: grid;
  gap: 10px;
  padding: 20px 24px;
  border: 2px solid var(--vermilion);
  background-color: color-mix(in srgb, var(--sakura) 20%, var(--paper-warm));
}

.paper-review-error__title {
  margin: 0;
  color: var(--vermilion);
  font-size: 16px;
  font-weight: 700;
}

.paper-review-error__body {
  margin: 0;
  color: var(--ink);
  font-size: 15px;
  line-height: 1.8;
}

.paper-review-error__hint {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}
</style>
