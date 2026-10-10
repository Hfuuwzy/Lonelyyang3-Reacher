import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

// Production excludes /prototype/ routes via the pages:extend hook, so the
// regular `nuxt build` never compiles this page. This test compiles the
// paper-task SFC (template + script) directly with the Vue SFC compiler to
// keep the dev-only route type-checked and syntax-valid in the unit suite.
const SFC_PATH = 'app/pages/prototype/paper-task.vue'

describe('paper-task SFC compilation', () => {
  it('compiles paper-task.vue with template and script', () => {
    const source = readFileSync(new URL(`../../${SFC_PATH}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: SFC_PATH })
    expect(errors).toEqual([])

    if (descriptor.template !== null) {
      const compiledTemplate = compileTemplate({
        source: descriptor.template.content,
        filename: SFC_PATH,
        id: SFC_PATH,
      })
      expect(compiledTemplate.errors).toEqual([])
    }

    const compiledScript = compileScript(descriptor, { id: SFC_PATH })
    expect(compiledScript.errors ?? []).toEqual([])
  })
})