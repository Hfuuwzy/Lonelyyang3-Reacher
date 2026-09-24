<template>
  <aside data-testid="right-nav-rail" class="right-nav-rail" aria-label="Site navigation controls">
    <NuxtLink :to="localePath('/')" data-testid="right-nav-brand" class="rail-brand" aria-label="Lonelyyang3 home">
      <span class="rail-brand__name">Lonelyyang3</span>
      <span class="rail-brand__subtitle">和风门户</span>
    </NuxtLink>

    <button
      type="button"
      data-testid="right-nav-menu-button"
      class="rail-menu"
      :aria-label="open ? 'Close navigation' : 'Open navigation'"
      :aria-expanded="open"
      aria-controls="right-nav-drawer"
      @click="handleMenuClick"
    >
      <IconsPaperIcons
        :open="open"
        :test-id="open ? 'right-nav-close-icon' : 'right-nav-menu-icon'"
      />
    </button>

    <nav data-testid="right-nav-share-links" class="rail-share" aria-label="Social links">
      <a
        class="rail-share__link"
        href="https://github.com/Hfuuwzy"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub profile"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 18c-4.5 1.5-4.5-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3 0 6.1-1.5 6.1-6.5A5.1 5.1 0 0 0 18.8 4.5 4.7 4.7 0 0 0 18.7 1S17.6.6 15 2.3a13.4 13.4 0 0 0-6 0C6.4.6 5.3 1 5.3 1a4.7 4.7 0 0 0-.1 3.5A5.1 5.1 0 0 0 3.8 8c0 5 3.1 6.5 6.1 6.5a3.4 3.4 0 0 0-.9 2.6V21" />
        </svg>
      </a>
    </nav>
  </aside>
</template>

<script setup lang="ts">
interface Props {
  readonly open: boolean
}

interface Emits {
  toggle: []
  close: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const localePath = useLocalePath()

function handleMenuClick(): void {
  if (props.open) {
    emit('close')
    return
  }

  emit('toggle')
}
</script>

<style scoped>
.right-nav-rail {
  position: fixed;
  z-index: 60;
  inset-block: 0;
  inset-inline-end: 0;
  display: flex;
  inline-size: var(--rail-width);
  flex-direction: column;
  align-items: center;
  padding-block: 32px 24px;
  border-inline-start: 1px solid var(--rule);
  background-color: var(--nav-paper);
  background-image: var(--nav-paper-texture);
  color: var(--ink);
}

.rail-brand {
  display: inline-flex;
  min-inline-size: 44px;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
  writing-mode: vertical-rl;
}

.rail-brand__name {
  font-family: var(--font-mincho);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.16em;
}

.rail-brand__subtitle {
  color: var(--ink-soft);
  font-size: 12px;
  letter-spacing: 0.24em;
}

.rail-menu {
  position: absolute;
  inset-block-start: 50%;
  display: grid;
  inline-size: 48px;
  block-size: 48px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  transform: translateY(-50%);
}

.rail-menu:hover {
  border-color: var(--rule);
  background: var(--sakura);
  color: var(--vermilion);
}

.rail-menu:focus-visible,
.rail-brand:focus-visible,
.rail-share__link:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.rail-share {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-block-start: auto;
}

.rail-share__link {
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  color: var(--ink-soft);
}

.rail-share__link:hover {
  color: var(--vermilion);
}

.rail-share__link svg {
  inline-size: 22px;
  block-size: 22px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

@media (width < 1024px) {
  .right-nav-rail {
    inline-size: var(--rail-width-tablet);
  }
}

@media (width < 768px) {
  .right-nav-rail {
    inline-size: var(--rail-width-mobile);
    padding-block: 24px 16px;
  }

  .rail-brand__subtitle {
    display: none;
  }
}

</style>
