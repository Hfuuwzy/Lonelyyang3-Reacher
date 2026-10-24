<template>
  <div class="article-table-scroll" tabindex="0" role="region" aria-label="文章表格；内容过宽时可横向滚动">
    <table class="article-table-scroll__table">
      <slot />
    </table>
  </div>
</template>

<style scoped>
.article-table-scroll {
  max-inline-size: 100%;
  margin-block: 32px;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}

.article-table-scroll__table {
  inline-size: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: inherit;
}
</style>
