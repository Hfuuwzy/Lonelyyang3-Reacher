// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },

  devServer: {
    port: 3000,
  },

  modules: [
    '@nuxt/content',
    '@nuxtjs/tailwindcss',
    '@nuxtjs/i18n',
    '@nuxt/image',
    '@vueuse/nuxt',
  ],

  app: {
    head: {
      title: 'Lonelyyang3 - 个人专属门户',
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      meta: [
        { name: 'description', content: '个人专属门户网站，展示博客、开源作品、推荐内容等' },
        { name: 'theme-color', content: '#f8f5ed' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', sizes: '1254x1254', href: '/images/brand/site-icon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700;900&family=Noto+Serif+JP:wght@400;600;700;900&display=swap',
        },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  content: {
    highlight: {
      theme: 'github-dark',
    },
  },

  i18n: {
    locales: [
      { code: 'zh', name: '中文', file: 'zh.json' },
      { code: 'ja', name: '日本語', file: 'ja.json' },
    ],
    defaultLocale: 'zh',
    strategy: 'prefix_except_default',
  },

  image: {},

  tailwindcss: {
    configPath: 'tailwind.config.ts',
  },

  routeRules: {
    '/': { prerender: true },
    '/blog': { swr: 3600 },
    '/projects/**': { swr: 3600 },
  },
})
