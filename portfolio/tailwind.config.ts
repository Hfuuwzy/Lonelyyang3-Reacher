import type { Config } from 'tailwindcss'

export default <Config>{
  content: [
    './app/components/**/*.{js,vue,ts}',
    './app/layouts/**/*.vue',
    './app/pages/**/*.vue',
    './app/plugins/**/*.{js,ts}',
    './app/app.vue',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--vermilion)',
        },
        surface: 'var(--color-surface)',
        bg: 'var(--color-bg)',
        text: {
          DEFAULT: 'var(--color-text)',
          secondary: 'var(--color-text-secondary)',
        },
        border: 'var(--color-border)',
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'sans-serif'],
        serif: [
          'YakuHanMP',
          'Noto Serif JP',
          'Yu Mincho',
          'YuMincho',
          'Hiragino Mincho ProN',
          'Noto Serif SC',
          'Songti SC',
          'STSong',
          'SimSun',
          'serif',
        ],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
