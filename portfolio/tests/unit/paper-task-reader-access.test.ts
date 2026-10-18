/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPaperTaskReader } from '../../server/paper-task/reader-access'
import type { StoredSource } from '../../server/paper-task/source-store'
import {
  paperTaskPdfPath,
  projectPaperTaskReaderView,
} from '../../app/utils/paper-task-reader-contract'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const MASTER = '# 中文主稿\n\n## 方法\n\n正文。'
const REPORT = '# 深读报告\n\n## 主要发现\n\n论文报告了一项结果。'
const PDF = new Uint8Array(Buffer.from('%PDF-1.4\nfixture\n'))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('paper task reader view', () => {
  it('exposes both readable masters with honest branch status and controlled assets', () => {
    const root = fixture()
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'preview-ready',
      'deep-reading': 'needs-confirmation',
    }, storedSource())

    expect(view).not.toBeUndefined()
    expect(view?.documents).toMatchObject([
      {
        branch: 'translation',
        status: 'preview',
        markdown: MASTER,
        notice: null,
        assets: [{ id: 'asset-abc', kind: 'table', caption: 'Table 1. Outcomes', availability: 'available' }],
      },
      {
        branch: 'deep-reading',
        status: 'needs-confirmation',
        markdown: REPORT,
        notice: '报告保留了未完成或未核实材料；已有可读内容保留。',
        assets: [],
      },
    ])
    expect(view?.pdfs.original.available).toBe(true)
    expect(view?.pdfs.translated.available).toBe(false)
  })

  it('keeps the other readable branch visible when a sibling failed', () => {
    const root = fixture()
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'failed',
      'deep-reading': 'preview-ready',
    }, storedSource())

    expect(view?.documents.map((document) => document.branch)).toEqual(['deep-reading'])
    expect(view?.documents[0]?.status).toBe('preview')
  })

  it('does not surface a failed branch even when its files still exist', () => {
    const root = fixture()
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'preview-ready',
      'deep-reading': 'failed',
    }, storedSource())

    expect(view?.documents.map((document) => document.branch)).toEqual(['translation'])
  })

  it('marks a stale translation with a short actionable notice', () => {
    const root = fixture({ translationStatus: 'needs-update' })
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'needs-confirmation',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.documents[0]?.notice).toBe('原文修正后，部分段落可能已过期；已有可读内容保留。')
  })

  it('offers the translated PDF only when the branch is complete and the page gate passes', () => {
    const root = fixture({ withTranslatedPdf: true })
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'complete',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.pdfs.translated.available).toBe(true)
  })

  it('keeps the translated PDF unavailable while the branch is not complete', () => {
    const root = fixture({ withTranslatedPdf: true })
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'needs-confirmation',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.pdfs.translated.available).toBe(false)
  })

  it('projects only the matching task UUID', () => {
    const root = fixture()
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'preview-ready',
      'deep-reading': 'not-selected',
    }, storedSource())
    expect(projectPaperTaskReaderView(view, TASK_ID)).toEqual(view)
    expect(projectPaperTaskReaderView(view, '123e4567-e89b-12d3-a456-426614174001')).toBeNull()
  })

  it('uses one PDF route family so translated open and download resolve the same file', () => {
    const open = paperTaskPdfPath(TASK_ID, 'translated', 'open')
    const download = paperTaskPdfPath(TASK_ID, 'translated', 'download')
    expect(new URL(open, 'http://localhost').pathname).toBe(new URL(download, 'http://localhost').pathname)
    expect(download).toContain('download=1')
    expect(paperTaskPdfPath(TASK_ID, 'original', 'open')).not.toBe(open)
  })
})

function storedSource(): StoredSource {
  const record = (id: string, order: number, kind: 'heading' | 'body' | 'table', text: string) => ({
    id,
    order,
    kind,
    text,
    state: 'present' as const,
    page: 1,
    bbox: [0, 0, 10, 10] as const,
    sectionId: null,
    context: '',
    links: [],
    revision: 1,
  })
  return {
    source: {
      status: 'complete',
      pageCount: 1,
      records: [
        record('p1-r1', 1, 'heading', '标题'),
        record('p1-r2', 2, 'body', '正文。'),
        record('p1-r3', 3, 'table', 'Table 1. Outcomes\nCondition A'),
      ],
    },
    revision: 1,
    assets: [{
      id: 'asset-abc',
      recordId: 'p1-r3',
      page: 1,
      bbox: [0, 0, 10, 10],
      availability: 'available',
      understanding: 'unverified',
    }],
  }
}

function fixture(overrides: {
  readonly translationStatus?: 'complete' | 'incomplete' | 'needs-update'
  readonly withTranslatedPdf?: boolean
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-reader-'))
  roots.push(root)
  const translation = join(root, 'drafts', 'translation')
  const reading = join(root, 'drafts', 'deep-reading')
  mkdirSync(translation, { recursive: true })
  mkdirSync(reading, { recursive: true })
  const masterSha = createHash('sha256').update(MASTER).digest('hex')
  writeFileSync(join(translation, 'master.md'), MASTER)
  writeFileSync(join(translation, 'preview.md'), MASTER)
  writeFileSync(join(translation, 'translation.json'), JSON.stringify({
    status: overrides.translationStatus ?? 'complete',
    masterSha256: masterSha,
    segments: [{ index: 0, stale: overrides.translationStatus === 'needs-update' }],
    assets: [{ id: 'asset-abc', recordId: 'p1-r3', kind: 'table', caption: 'Table 1. Outcomes', availability: 'available' }],
    unresolved: [],
  }))
  writeFileSync(join(reading, 'report.md'), REPORT)
  writeFileSync(join(reading, 'preview.md'), REPORT)
  writeFileSync(join(reading, 'evidence.json'), JSON.stringify({
    manuscriptSha256: createHash('sha256').update(REPORT).digest('hex'),
    status: 'needs-confirmation',
    claims: [],
    assets: [],
    uncompletedReasons: [],
    unresolvedRecordIds: [],
    unverifiedAssetIds: [],
  }))
  writeFileSync(join(root, 'original.pdf'), PDF)
  if (overrides.withTranslatedPdf === true) {
    writeFileSync(join(translation, 'translated.pdf'), PDF)
    writeFileSync(join(translation, 'pdf-format.json'), JSON.stringify({
      format: 'pdf',
      build: 'built',
      sourceMasterSha256: masterSha,
      artifactMasterSha256: masterSha,
      expectedPageCount: 1,
      pages: [{ page: 1, status: 'passed' }],
    }))
  }
  return root
}
