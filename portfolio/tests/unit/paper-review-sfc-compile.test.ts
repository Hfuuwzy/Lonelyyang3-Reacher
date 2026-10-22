import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

// Production excludes /prototype/ routes via the pages:extend hook, so the
// regular `nuxt build` never compiles these pages. This test compiles every
// paper-review SFC (template + script) directly with the Vue SFC compiler to
// keep the dev-only routes type-checked and syntax-valid in the unit suite.
const SFC_PATHS = [
  'app/pages/prototype/paper-review.vue',
  'app/pages/prototype/paper-review/index.vue',
  'app/pages/prototype/paper-review/report.vue',
  'app/pages/prototype/paper-review/translation.vue',
  'app/pages/prototype/paper-reader.vue',
  'app/components/prototype/PaperReaderDocuments.vue',
  'app/components/prototype/PaperReviewPageShell.vue',
  'app/components/prototype/PaperReviewReader.vue',
  'app/components/prototype/PaperReviewSummary.vue',
  'app/components/prototype/ReaderArticleHeader.vue',
]

describe('paper-review SFC compilation', () => {
  it.each(SFC_PATHS)('compiles %s with template and script', (relativePath) => {
    const source = readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: relativePath })
    expect(errors).toEqual([])

    if (descriptor.template !== null) {
      const compiledTemplate = compileTemplate({
        source: descriptor.template.content,
        filename: relativePath,
        id: relativePath,
      })
      expect(compiledTemplate.errors).toEqual([])
    }

    const compiledScript = compileScript(descriptor, { id: relativePath })
    expect(compiledScript.errors ?? []).toEqual([])
  })
})
