import { describe, expect, it } from 'vitest'
import { translationBlockers } from '../../server/paper-task/translation-eligibility.mjs'

function source(id: string, kind: string, text: string) {
  return { record: { id, kind, text, state: 'present' } }
}

function segment(markdown: string, ids: readonly string[], stale = false) {
  return { markdown, stale, dependencies: ids.map(recordId => ({ recordId })) }
}

describe('translation manuscript eligibility boundaries', () => {
  it('combines paragraphs that translate the same source instead of requiring each to repeat it', () => {
    // Given one source passage translated across three natural paragraphs.
    const records = [source('p1-r0', 'body', 'A detailed source statement. '.repeat(20))]
    const segments = Array.from({ length: 3 }, () => segment('这是一段连贯的中文译文。'.repeat(5), ['p1-r0']))

    // When the complete manuscript is evaluated.
    const blockers = translationBlockers({ records, segments, unresolved: [], sourceStatus: 'complete' })

    // Then paragraph splitting does not turn an adequate manuscript into a short placeholder.
    expect(blockers).not.toContain('master-too-short')
  })

  it('does not count a translated title as represented body prose', () => {
    const records = [source('p1-r0', 'heading', 'Title'), source('p1-r1', 'body', 'Detailed research findings. '.repeat(10))]
    const segments = [segment('# 论文标题', ['p1-r0']), segment('待补：正文尚未完成。', [])]

    const blockers = translationBlockers({ records, segments, unresolved: [{ recordId: 'p1-r1', reason: '正文尚未完成。' }], sourceStatus: 'complete' })

    expect(blockers).toContain('translation-no-prose')
  })

  it('does not let a reference inside a mixed segment pad missing translated prose', () => {
    const reference = 'Smith, J. (2026). A long reference entry. '.repeat(30)
    const records = [source('p1-r0', 'body', 'Detailed research findings. '.repeat(20)), source('p1-r1', 'reference', reference)]
    const segments = [segment(`测试段\n\n${reference}`, ['p1-r0', 'p1-r1'])]

    const blockers = translationBlockers({ records, segments, unresolved: [], sourceStatus: 'complete' })

    expect(blockers).toContain('master-too-short')
  })

  it('does not treat repeated numeric tokens as translated prose', () => {
    const records = [source('p1-r0', 'body', 'Detailed research findings. '.repeat(20))]
    const segments = [segment(`测试段 ${'12345 '.repeat(100)}`, ['p1-r0'])]

    const blockers = translationBlockers({ records, segments, unresolved: [], sourceStatus: 'complete' })

    expect(blockers).toContain('master-too-short')
  })

  it('keeps a stale manuscript readable when a later source correction is much longer', () => {
    const records = [source('p1-r0', 'body', 'A newly corrected and substantially longer source passage. '.repeat(30))]
    const segments = [segment('原有译文保留，等待根据修正后的原文更新。', ['p1-r0'], true)]

    const blockers = translationBlockers({ records, segments, unresolved: [], sourceStatus: 'complete', translationStatus: 'needs-update' })

    expect(blockers).not.toContain('master-too-short')
  })
})
