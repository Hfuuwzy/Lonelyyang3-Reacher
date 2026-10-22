import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

// Production excludes /prototype/ routes via the pages:extend hook, so the
// regular `nuxt build` never compiles these surfaces. Compile their SFCs
// directly to keep the dev-only UI syntax-valid in the unit suite.
const SFC_PATHS = [
  'app/pages/prototype/paper-task.vue',
  'app/pages/prototype/paper-task-reader-fixture.vue',
  'app/pages/prototype/api-settings.vue',
  'app/components/prototype/PaperTaskApiSettings.vue',
  'app/components/prototype/PaperTaskTranslationPreview.vue',
  'app/components/prototype/PaperTaskReader.vue',
  'app/components/prototype/PaperTaskExportActions.vue',
] as const

describe('paper-task SFC compilation', () => {
  for (const SFC_PATH of SFC_PATHS) {
    it(`compiles ${SFC_PATH} with template and script`, () => {
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

      compileScript(descriptor, { id: SFC_PATH })
    })
  }
})
