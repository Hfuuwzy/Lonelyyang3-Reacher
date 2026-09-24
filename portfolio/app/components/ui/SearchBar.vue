<template>
  <div class="search-bar" :class="{ 'search-bar--compact': props.compact }">
    <input
      :id="props.inputId"
      v-model="searchQuery"
      data-testid="drawer-search-input"
      type="text"
      :placeholder="t('drawer.searchPlaceholder')"
      :aria-label="t('drawer.searchPlaceholder')"
      class="search-bar__input"
      @input="handleSearch"
      @focus="showResults = true"
      @blur="hideResults"
    />
    <svg class="search-bar__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>

    <div
      v-if="showResults && searchResults.length > 0"
      data-testid="search-results"
      class="search-results"
    >
      <NuxtLink
        v-for="result in searchResults"
        :key="result.path"
        :to="result.path"
        :data-testid="`search-result-${result.slug}`"
        class="search-result"
        @click="handleResultClick"
      >
        <span class="search-result__title">{{ result.title }}</span>
        <span class="search-result__description">{{ result.description }}</span>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  readonly compact?: boolean
  readonly inputId?: string
}

interface SearchResult {
  readonly path: string
  readonly slug: string
  readonly title?: string
  readonly description?: string
}

const props = defineProps<Props>()
const { locale, t } = useI18n()
const localePath = useLocalePath()
const searchQuery = ref('')
const searchResults = ref<SearchResult[]>([])
const showResults = ref(false)

async function handleSearch(): Promise<void> {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }

  const normalizedQuery = searchQuery.value.trim().toLocaleLowerCase()
  const posts = await queryCollection('blog').all()
  const localeRoot = localePath({ path: '/' }, locale.value)

  searchResults.value = posts
    .filter((post) => {
      const searchableText = [
        post.title,
        post.description,
        post.category,
        ...(post.tags ?? []),
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLocaleLowerCase()

      return searchableText.includes(normalizedQuery)
    })
    .map(post => ({
      path: localeRoot === '/' ? post.path : `${localeRoot.replace(/\/$/, '')}${post.path}`,
      slug: post.path.split('/').filter(Boolean).at(-1) ?? post.path,
      title: post.title,
      description: post.description,
    }))
}

function hideResults(): void {
  setTimeout(() => {
    showResults.value = false
  }, 200)
}

function handleResultClick(): void {
  searchQuery.value = ''
  searchResults.value = []
  showResults.value = false
}
</script>

<style scoped>
.search-bar {
  position: relative;
  inline-size: 100%;
}

.search-bar__input {
  inline-size: 100%;
  min-block-size: 48px;
  padding: 12px 16px 12px 44px;
  border: 1px solid var(--rule);
  border-radius: 0;
  background: var(--paper-warm);
  color: var(--ink);
  font: inherit;
}

.search-bar--compact .search-bar__input {
  min-block-size: 44px;
  padding-block: 8px;
}

.search-bar__input::placeholder {
  color: var(--ink-soft);
}

.search-bar__input:focus-visible {
  border-color: var(--vermilion);
  outline: 3px solid var(--vermilion);
  outline-offset: 2px;
}

.search-bar__icon {
  position: absolute;
  inset-block-start: 14px;
  inset-inline-start: 16px;
  inline-size: 20px;
  block-size: 20px;
  color: var(--ink-soft);
  pointer-events: none;
}

.search-results {
  position: absolute;
  z-index: 70;
  inset-block-start: calc(100% + 8px);
  inset-inline: 0;
  max-block-size: 320px;
  overflow-y: auto;
  border: 1px solid var(--rule);
  background-color: var(--nav-paper);
  background-image: var(--nav-paper-texture);
}

.search-result {
  display: grid;
  gap: 4px;
  padding: 12px 16px;
  border-block-end: 1px dotted var(--rule);
  color: var(--ink);
  text-decoration: none;
}

.search-result:last-child {
  border-block-end: 0;
}

.search-result:hover {
  background: var(--sakura);
}

.search-result:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: -3px;
}

.search-result__title {
  font-size: 14px;
  font-weight: 700;
}

.search-result__description {
  overflow: hidden;
  color: var(--ink-soft);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
