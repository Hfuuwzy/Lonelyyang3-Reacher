import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const appPath = fileURLToPath(new URL('./app', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': appPath,
      '~': appPath,
    },
  },
  plugins: [vue({ template: { transformAssetUrls: false } })],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
