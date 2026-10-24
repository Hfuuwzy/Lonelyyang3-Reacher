import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { parse } from 'vue/compiler-sfc'
import { createServer } from 'vite'
import { describe, expect, it } from 'vitest'

describe('right navigation drawer styles', () => {
  it('transforms every external scoped style from a cold Vite request', async () => {
    const root = resolve(process.cwd())
    const componentPath = resolve(root, 'app/components/layout/RightNavDrawer.vue')
    const { descriptor, errors } = parse(readFileSync(componentPath, 'utf8'), { filename: componentPath })
    const styles = descriptor.styles
      .map((style, index) => ({ style, index }))
      .filter(({ style }) => style.scoped && style.src)

    expect(errors).toEqual([])
    expect(styles.length).toBeGreaterThan(0)

    const server = await createServer({
      appType: 'custom',
      configFile: false,
      logLevel: 'silent',
      plugins: [vue()],
      root,
      server: { middlewareMode: true },
    })

    try {
      let compiledCss = ''

      for (const { style, index } of styles) {
        const sourcePath = resolve(dirname(componentPath), style.src!)
        // A unique src id exercises Vite's fallback when the owning SFC descriptor is not cached.
        const request = `${sourcePath}?direct&vue&type=style&index=${index}&src=cold-regression&scoped=cold-regression&lang.css`
        const transformed = await server.transformRequest(request)

        expect(transformed).not.toBeNull()
        compiledCss += transformed?.code ?? ''
      }

      expect(compiledCss).toContain('.drawer-tools')
      expect(compiledCss).toContain('.drawer-search-toggle')
    }
    finally {
      await server.close()
    }
  })
})
