/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPaperTaskReader } from '../../server/paper-task/reader-access'
import type { StoredSource } from '../../server/paper-task/source-store'
import { paperTaskFragmentSchema } from '../../app/utils/paper-task-contract'
import {
  paperTaskArtifactPath,
  paperTaskPdfPath,
  projectPaperTaskReaderView,
  paperTaskReaderViewSchema,
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
        notice: '报告保留了未完成或未核实材料；已有可读内容保留，请返回任务工作台核对原文资料。',
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

    expect(view?.documents.map((document) => document.branch)).toEqual(['translation', 'deep-reading'])
    expect(view?.documents[0]).toMatchObject({
      status: 'fragment',
      markdown: MASTER,
      fragment: {
        taskId: TASK_ID,
        branch: 'translation',
        identity: `sha256:${createHash('sha256').update(MASTER).digest('hex')}`,
        source: 'drafts/translation/preview.md',
        reason: 'branch-failed',
      },
    })
    expect(view?.documents[1]?.status).toBe('needs-confirmation')
  })

  it('uses only a failed branch preview fragment even when its old master files still exist', () => {
    const root = fixture()
    const preview = '# Saved fragment\n\nOnly the failed branch preview belongs in the reader.'
    writeFileSync(join(root, 'drafts', 'deep-reading', 'preview.md'), preview)
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'preview-ready',
      'deep-reading': 'failed',
    }, storedSource())

    expect(view?.documents.map((document) => document.branch)).toEqual(['translation', 'deep-reading'])
    expect(view?.documents[1]).toMatchObject({
      branch: 'deep-reading',
      status: 'fragment',
      markdown: preview,
      fragment: {
        reason: 'branch-failed',
        source: 'drafts/deep-reading/preview.md',
      },
    })
    expect(view?.documents[1]?.markdown).not.toBe(REPORT)
  })

  it('uses the matching branch canonical body as an explicitly sourced fragment when its preview mirror is absent', () => {
    const root = fixture()
    const previewPath = join(root, 'drafts', 'translation', 'preview.md')
    rmSync(previewPath)

    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'failed',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.documents).toMatchObject([{
      branch: 'translation',
      status: 'fragment',
      markdown: MASTER,
      fragment: {
        taskId: TASK_ID,
        branch: 'translation',
        source: 'drafts/translation/master.md',
        reason: 'branch-failed',
      },
    }])
    expect(view?.documents[0]?.status).not.toBe('complete')
  })

  it('never reads a canonical body from a sibling branch and rejects a symlinked canonical body', () => {
    const wrongBranchRoot = fixture()
    rmSync(join(wrongBranchRoot, 'drafts', 'translation', 'preview.md'))
    rmSync(join(wrongBranchRoot, 'drafts', 'translation', 'master.md'))
    writeFileSync(join(wrongBranchRoot, 'drafts', 'deep-reading', 'report.md'), REPORT)
    const wrongBranch = readPaperTaskReader(TASK_ID, wrongBranchRoot, {
      translation: 'failed',
      'deep-reading': 'not-selected',
    }, storedSource())
    expect(wrongBranch?.documents).toEqual([])

    const symlinkRoot = fixture()
    const translationRoot = join(symlinkRoot, 'drafts', 'translation')
    rmSync(join(translationRoot, 'preview.md'))
    rmSync(join(translationRoot, 'master.md'))
    const externalPath = join(symlinkRoot, 'outside.md')
    writeFileSync(externalPath, MASTER)
    symlinkSync(externalPath, join(translationRoot, 'master.md'), 'file')
    const symlinked = readPaperTaskReader(TASK_ID, symlinkRoot, {
      translation: 'failed',
      'deep-reading': 'not-selected',
    }, storedSource())
    expect(symlinked?.documents).toEqual([])
  })

  it('marks a stale translation with a short actionable notice', () => {
    const root = fixture({ translationStatus: 'needs-update' })
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'needs-confirmation',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.documents[0]?.notice).toBe('原文修正后，部分段落可能已过期；已有可读内容保留，请返回任务工作台核对原文资料。')
  })

  it('never labels a stale master as complete even when the branch state was complete', () => {
    const root = fixture({ translationStatus: 'needs-update' })
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'complete',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.documents[0]?.status).toBe('needs-confirmation')
  })

  it('blocks a previously inspected PDF when its complete branch master becomes stale', () => {
    const root = fixture({ translationStatus: 'needs-update', withTranslatedPdf: true })
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'complete',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.documents[0]?.formats.pdf).toMatchObject({
      status: 'needs-confirmation',
      build: 'built',
      inspectionAvailable: true,
      finalAvailable: false,
    })
    expect(view?.pdfs.original.available).toBe(true)
    expect(view?.pdfs.translated.available).toBe(false)
  })

  it('offers the translated PDF only when the branch is complete and the page gate passes', () => {
    const root = fixture({ withTranslatedPdf: true })
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'complete',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.pdfs.translated.available).toBe(true)
    expect(view?.documents[0]?.formats.pdf.pages).toEqual([{
      page: 1, status: 'passed', expected: '译文正文完整。', observed: '译文正文完整。', evidence: '实际检查第 1 页。',
    }])
  })

  it('keeps the translated PDF unavailable while the branch is not complete', () => {
    const root = fixture({ withTranslatedPdf: true })
    const view = readPaperTaskReader(TASK_ID, root, {
      translation: 'needs-confirmation',
      'deep-reading': 'not-selected',
    }, storedSource())

    expect(view?.pdfs.translated.available).toBe(false)
    expect(view?.pdfs.translated.message).toContain('待确认')
    expect(view?.pdfs.translated.message).toContain('Markdown')
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

  it('requires fragment provenance to match the task and branch and rejects incomplete or forged fragment metadata', () => {
    const root = fixture()
    const base = readPaperTaskReader(TASK_ID, root, {
      translation: 'preview-ready',
      'deep-reading': 'not-selected',
    }, storedSource())
    const document = base?.documents[0]
    if (base === undefined || document === undefined) throw new Error('reader fixture unavailable')
    const fragment = {
      taskId: TASK_ID,
      branch: 'translation',
      identity: `sha256:${'c'.repeat(64)}`,
      source: 'drafts/translation/preview.md',
      reason: 'branch-failed',
      quality: null,
    }
    const valid = {
      ...base,
      documents: [{ ...document, status: 'fragment', fragment }],
    }
    expect(paperTaskReaderViewSchema.safeParse(valid).success).toBe(true)

    const malformedDocuments = [
      { ...document, status: 'fragment' },
      { ...document, status: 'fragment', fragment: { ...fragment, taskId: '123e4567-e89b-12d3-a456-426614174001' } },
      { ...document, status: 'fragment', fragment: { ...fragment, branch: 'deep-reading' } },
      { ...document, status: 'fragment', fragment: { ...fragment, source: 'drafts/deep-reading/preview.md' } },
      { ...document, status: 'fragment', fragment: { ...fragment, source: 'drafts/translation/report.md' } },
      { ...document, status: 'fragment', fragment: { ...fragment, source: 'drafts/translation/../../source.md' } },
      { ...document, status: 'fragment', fragment: { ...fragment, identity: 'not-a-content-digest' } },
      { ...document, status: 'preview', fragment },
    ]
    for (const malformed of malformedDocuments) {
      expect(paperTaskReaderViewSchema.safeParse({ ...base, documents: [malformed] }).success).toBe(false)
    }
    expect(paperTaskFragmentSchema.safeParse({ ...fragment, source: 'drafts/translation/master.md' }).success).toBe(true)
    expect(paperTaskFragmentSchema.safeParse({ ...fragment, source: 'drafts/deep-reading/report.md' }).success).toBe(false)
  })

  it('uses one PDF route family so translated open and download resolve the same file', () => {
    const open = paperTaskPdfPath(TASK_ID, 'translated', 'open')
    const download = paperTaskPdfPath(TASK_ID, 'translated', 'download')
    expect(new URL(open, 'http://localhost').pathname).toBe(new URL(download, 'http://localhost').pathname)
    expect(download).toContain('download=1')
    expect(paperTaskPdfPath(TASK_ID, 'original', 'open')).not.toBe(open)
  })

  it('includes the inspected PDF hash in the inspection copy URL', () => {
    const artifactSha256 = 'a'.repeat(64)
    const path = paperTaskArtifactPath(TASK_ID, 'translation', 'pdf', { inspection: true, artifactSha256 })

    expect(new URL(path, 'http://localhost').searchParams.get('artifactSha256')).toBe(artifactSha256)
    expect(new URL(path, 'http://localhost').searchParams.get('inspection')).toBe('1')
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
    segments: [{
      index: 0, markdown: MASTER, stale: overrides.translationStatus === 'needs-update',
      dependencies: [
        { recordId: 'p1-r1', revision: 1 },
        { recordId: 'p1-r2', revision: 1 },
      ],
    }],
    assets: [{ id: 'asset-abc', recordId: 'p1-r3', kind: 'table', caption: 'Table 1. Outcomes', availability: 'available' }],
    unresolved: [],
  }))
  const sourceRecords = [
    { record: { id: 'p1-r1', kind: 'heading', state: 'present', text: '标题' }, revision: 1 },
    { record: { id: 'p1-r2', kind: 'body', state: 'present', text: '正文。' }, revision: 1 },
    { record: { id: 'p1-r3', kind: 'table', state: 'present', text: 'Table 1. Outcomes\nCondition A' }, revision: 1 },
  ]
  mkdirSync(join(root, 'source-records'), { recursive: true })
  writeFileSync(join(root, 'source-index.json'), JSON.stringify(sourceRecords.map(({ record }) => record.id)))
  writeFileSync(join(root, 'source-state.json'), JSON.stringify({ status: 'complete' }))
  for (const stored of sourceRecords) writeFileSync(join(root, 'source-records', `${stored.record.id}.json`), JSON.stringify(stored))
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
      version: 1,
      branch: 'translation',
      format: 'pdf',
      build: 'built',
      sourceMasterSha256: masterSha,
      artifactMasterSha256: masterSha,
      artifactSha256: createHash('sha256').update(PDF).digest('hex'),
      boundaryCheck: { method: 'ordered-normalized-text-extraction', passed: true, sourceMasterSha256: masterSha, sourceBlocks: 1, matchedBlocks: 1 },
      expectedPageCount: 1,
      pages: [{ page: 1, status: 'passed', expected: '译文正文完整。', observed: '译文正文完整。', evidence: '实际检查第 1 页。' }],
    }))
  }
  return root
}
