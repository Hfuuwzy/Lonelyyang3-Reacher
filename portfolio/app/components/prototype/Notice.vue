<template>
  <aside data-testid="prototype-notice" class="prototype-notice">
    <span class="prototype-notice__stamp">警告</span>
    <div class="prototype-notice__copy">
      <p class="prototype-notice__title">原型页面：请勿输入真实 API 密钥</p>
      <p class="prototype-notice__body">本页面不发送任何网络请求、不写入任何存储、也不保存输入内容；任何填写都只停留在当前页面内存中，刷新即消失。</p>
    </div>
  </aside>
</template>

<style scoped>
.prototype-notice {
  display: flex;
  align-items: center;
  gap: 24px;
  max-inline-size: 960px;
  padding: 20px 24px;
  border: 2px solid var(--vermilion);
  background-color: color-mix(in srgb, var(--sakura) 20%, var(--paper-warm));
}

.prototype-notice__stamp {
  display: inline-grid;
  flex: none;
  place-items: center;
  min-inline-size: 44px;
  min-block-size: 44px;
  border: 2px solid var(--vermilion);
  color: var(--vermilion);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1;
  writing-mode: vertical-rl;
}

.prototype-notice__copy {
  display: grid;
  gap: 8px;
}

.prototype-notice__title {
  margin: 0;
  color: var(--vermilion);
  font-size: 16px;
  font-weight: 700;
}

.prototype-notice__body {
  margin: 0;
  color: var(--ink);
  font-size: 15px;
  line-height: 1.7;
}

@media (width < 480px) {
  .prototype-notice {
    align-items: flex-start;
    gap: 16px;
    padding: 16px;
  }
}
</style>
