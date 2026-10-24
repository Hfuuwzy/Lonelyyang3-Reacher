<template>
  <footer data-testid="home-details-footer" class="home-colophon" aria-label="页脚">
    <div class="home-colophon__petals" aria-hidden="true">
      <span v-for="petal in 9" :key="petal" :style="{ '--petal': petal }" />
    </div>
    <div class="home-colophon__paper">
      <svg class="home-colophon__pattern" aria-hidden="true" width="100%" height="100%">
        <defs>
          <pattern id="home-colophon-lattice" width="104" height="90" patternUnits="userSpaceOnUse">
            <g fill="none" stroke="currentColor" stroke-width="0.65">
              <path d="M0 0h104L52 90ZM0 0l52 30 52-30M52 30v60M0 0v60l52 30 52-30V0M0 60l52-30 52 30M52 0v30M26 15l26 15 26-15M26 75l26-45 26 45" />
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#home-colophon-lattice)" />
      </svg>
      <div class="home-colophon__content">
        <p class="home-colophon__eyebrow">MYSELF — WORLD</p>
        <NuxtLink :to="localePath('/')" class="home-colophon__brand" aria-label="Lonelyyang3 首页">
          <img
            src="/images/brand/lonelyyang3-wordmark.png"
            alt=""
            width="2048"
            height="682"
            loading="lazy"
          >
        </NuxtLink>
        <p class="home-colophon__message">记录所学，做些有用的东西。</p>
        <nav class="home-colophon__links" aria-label="页脚链接">
          <a href="#tools">使用工具</a>
          <NuxtLink :to="localePath('/blog')">浏览文章</NuxtLink>
          <NuxtLink :to="localePath('/about')">关于我</NuxtLink>
          <a href="https://github.com/Hfuuwzy" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
          <a href="/atom.xml">RSS</a>
        </nav>
        <p class="home-colophon__copyright">© {{ year }} Lonelyyang3</p>
      </div>
    </div>
    <div class="home-colophon__end">
      <span>学习 · 创作 · 日常</span>
      <a href="#home-visual">返回顶部 ↑</a>
    </div>
  </footer>
</template>

<script setup lang="ts">
const localePath = useLocalePath()
const year = new Date().getFullYear()
</script>

<style scoped>
.home-colophon {
  position: relative;
  padding-block-start: 84px;
  background-color: var(--paper);
  background-image: var(--paper-texture);
  background-blend-mode: multiply;
}

.home-colophon__paper {
  position: relative;
  isolation: isolate;
  padding: 64px 32px 48px;
  border-block: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
  background-color: color-mix(in srgb, var(--vermilion) 30%, var(--paper-warm));
  background-image:
    radial-gradient(ellipse at 24% 8%, color-mix(in srgb, var(--paper-warm) 55%, transparent), transparent 65%),
    radial-gradient(ellipse at 78% 90%, color-mix(in srgb, var(--sakura) 50%, transparent), transparent 55%),
    var(--paper-texture);
  background-blend-mode: normal, normal, multiply;
  box-shadow: 0 -3px 9px color-mix(in srgb, var(--ink) 7%, transparent), 0 3px 8px color-mix(in srgb, var(--ink) 7%, transparent);
}

.home-colophon__pattern {
  position: absolute;
  z-index: -1;
  inset: 0;
  color: var(--paper-warm);
  opacity: 0.36;
  pointer-events: none;
}

.home-colophon__content {
  text-align: center;
}

.home-colophon__eyebrow {
  font-size: 12px;
  letter-spacing: 0.4em;
}

.home-colophon__brand {
  display: block;
  inline-size: min(420px, 80%);
  margin: 24px auto 12px;
}

.home-colophon__brand img {
  display: block;
  inline-size: 100%;
  block-size: auto;
  filter: invert(var(--home-brand-theme-invert)) hue-rotate(var(--home-brand-theme-hue));
}

.home-colophon__message {
  font-size: 20px;
  letter-spacing: 0.18em;
}

.home-colophon__links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 28px;
  margin-block: 24px;
  font-size: 15px;
}

.home-colophon__links a,
.home-colophon__end a {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  text-underline-offset: 6px;
}

.home-colophon a:hover {
  color: var(--ink);
  text-decoration: underline;
}

.home-colophon a:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 5px;
}

.home-colophon__copyright {
  font-size: 13px;
  letter-spacing: 0.1em;
}

.home-colophon__end {
  display: flex;
  inline-size: min(1440px, calc(100% - 64px));
  min-block-size: 100px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-inline: auto;
  color: var(--ink-soft);
  font-size: 13px;
  letter-spacing: 0.12em;
}

.home-colophon__petals {
  position: absolute;
  inset: 0 0 auto;
  block-size: 84px;
  overflow: hidden;
  pointer-events: none;
}

.home-colophon__petals span {
  position: absolute;
  inset-block-start: calc(18px + mod(var(--petal), 3) * 16px);
  inset-inline-start: calc(var(--petal) * 10% - 3%);
  inline-size: 10px;
  block-size: 22px;
  border-radius: 90% 10% 90% 10%;
  background: color-mix(in srgb, var(--sakura) 70%, transparent);
  transform: rotate(calc(var(--petal) * 37deg));
}

@media (width < 768px) {
  .home-colophon__paper {
    padding: 48px 24px 32px;
  }

  .home-colophon__message {
    font-size: 17px;
  }

  .home-colophon__links {
    gap: 4px 20px;
  }

  .home-colophon__end {
    inline-size: calc(100% - 40px);
    font-size: 12px;
  }
}
</style>
