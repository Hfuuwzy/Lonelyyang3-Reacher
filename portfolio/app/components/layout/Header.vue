<template>
  <header class="sticky top-0 z-40 bg-surface/80 backdrop-blur-md border-b border-border">
    <div class="flex items-center justify-between px-4 lg:px-8 py-4">
      <!-- 搜索框 -->
      <div class="flex-1 max-w-md">
        <UiSearchBar />
      </div>

      <!-- 右侧工具栏 -->
      <div class="flex items-center space-x-3 ml-4">
        <UiThemeToggle />
      </div>
    </div>
  </header>
</template>
