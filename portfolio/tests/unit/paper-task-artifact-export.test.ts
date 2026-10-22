/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import {
  buildPaperTaskFormat,
  readPaperTaskArtifact,
  readPaperTaskFormatStatus,
  submitPaperTaskFormatInspection,
} from '../../server/paper-task/artifact-export'

const ROOTS: string[] = []
const MARKDOWN = '# 成果主稿\n\n这是同一份批准主稿的可读正文。'

afterEach(() => {
  for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('branch-scoped artifact export', () => {
  it('builds the selected branch format, binds it to the master, and requires every page inspection before final retrieval', async () => {
    const root = workspace('translation')
    const built = await buildPaperTaskFormat({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, assets: [], masterQuality: 'complete' })

    expect(built.build).toBe('built')
    expect(built.status).toBe('needs-confirmation')
    expect(built.finalAvailable).toBe(false)
    expect(built.inspectionAvailable).toBe(true)
    expect(readPaperTaskArtifact({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, masterQuality: 'complete' })).toBeUndefined()

    const reviewBytes = readPaperTaskArtifact({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, masterQuality: 'complete', purpose: 'inspection' })
    expect(reviewBytes?.subarray(0, 5).toString()).toBe('%PDF-')
    const artifactSha256 = built.artifactSha256
    if (artifactSha256 === undefined) throw new Error('expected artifact hash')
    const pages = Array.from({ length: built.expectedPageCount ?? 0 }, (_, index) => ({
      page: index + 1, status: 'passed' as const,
      expected: `Page ${index + 1} contains complete readable content.`,
      observed: `Page ${index + 1} contains complete readable content.`,
      evidence: `Inspected the actual PDF at page ${index + 1}.`,
    }))
    const inspected = await submitPaperTaskFormatInspection({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, masterQuality: 'complete', inspection: { artifactSha256, expectedPageCount: pages.length, pages } })

    expect(inspected.status).toBe('complete')
    expect(inspected.finalAvailable).toBe(true)
    expect(inspected.pages).toEqual(pages)
    expect(readPaperTaskArtifact({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, masterQuality: 'complete' })).toEqual(reviewBytes)
  }, 15_000)

  it('keeps Markdown and deep-reading outputs independent from a failed PDF build', async () => {
    const root = workspace('deep-reading')
    const markdown = await buildPaperTaskFormat({ root, branch: 'deep-reading', format: 'markdown', markdown: MARKDOWN, assets: [], masterQuality: 'preview' })

    expect(markdown.status).toBe('preview')
    expect(readPaperTaskArtifact({ root, branch: 'deep-reading', format: 'markdown', markdown: MARKDOWN, masterQuality: 'preview' })).toEqual(Buffer.from(MARKDOWN))
    expect(readPaperTaskFormatStatus(root, 'deep-reading', 'pdf', MARKDOWN, 'preview').build).toBe('unbuilt')
  })

  it('packages only the referenced controlled assets and preserves their exact bytes', async () => {
    const root = workspace('deep-reading')
    const manuscript = `${MARKDOWN}\n\n![受控图表](asset:asset-abc)`
    const sourceAsset = Buffer.from('controlled image fixture')
    const built = await buildPaperTaskFormat({
      root, branch: 'deep-reading', format: 'assets', markdown: manuscript, masterQuality: 'complete',
      assets: [{ id: 'asset-abc', caption: '原文图表', bytes: sourceAsset }, { id: 'asset-unreferenced', bytes: Buffer.from('not referenced') }],
    })
    const archiveBytes = readPaperTaskArtifact({ root, branch: 'deep-reading', format: 'assets', markdown: manuscript, masterQuality: 'complete' })
    expect(built.status).toBe('complete')
    expect(archiveBytes?.subarray(0, 2).toString()).toBe('PK')
    if (archiveBytes === undefined) throw new Error('asset archive is unavailable')
    const archive = await JSZip.loadAsync(archiveBytes)
    expect(Buffer.from(await archive.file('assets/asset-abc.png')!.async('nodebuffer'))).toEqual(sourceAsset)
    expect(archive.file('assets/asset-unreferenced.png')).toBeNull()
  })

  it('rejects page evidence unless its complete page range matches the current artifact identity', async () => {
    const root = workspace('translation')
    const built = await buildPaperTaskFormat({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, assets: [], masterQuality: 'complete' })
    const artifactSha256 = built.artifactSha256
    if (artifactSha256 === undefined) throw new Error('expected artifact hash')
    const badPages = [{ page: 2, status: 'passed' as const, expected: '正文完整。', observed: '正文完整。', evidence: '实际检查第 2 页。' }]

    await expect(submitPaperTaskFormatInspection({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, masterQuality: 'complete', inspection: { artifactSha256, expectedPageCount: built.expectedPageCount ?? 1, pages: badPages } })).rejects.toThrow()
    await expect(submitPaperTaskFormatInspection({ root, branch: 'translation', format: 'pdf', markdown: `${MARKDOWN}\n\n主稿发生变化。`, masterQuality: 'complete', inspection: { artifactSha256, expectedPageCount: built.expectedPageCount ?? 1, pages: [] } })).rejects.toThrow()
    const oversizedEvidence = Array.from({ length: built.expectedPageCount ?? 1 }, (_, index) => ({
      page: index + 1, status: 'passed' as const, expected: '正文完整。', observed: '正文完整。', evidence: 'e'.repeat(501),
    }))
    await expect(submitPaperTaskFormatInspection({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, masterQuality: 'complete', inspection: { artifactSha256, expectedPageCount: oversizedEvidence.length, pages: oversizedEvidence } })).rejects.toThrow()
  })

  it('rejects inspection evidence from an older PDF after a rebuild changes the artifact', async () => {
    const root = workspace('translation')
    const original = await buildPaperTaskFormat({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, assets: [], masterQuality: 'complete' })
    const artifactSha256 = original.artifactSha256
    if (artifactSha256 === undefined) throw new Error('expected artifact hash')
    const changedMaster = `${MARKDOWN}\n\n重建后的 PDF 内容。`
    const rebuilt = await buildPaperTaskFormat({ root, branch: 'translation', format: 'pdf', markdown: changedMaster, assets: [], masterQuality: 'complete' })
    const pages = Array.from({ length: rebuilt.expectedPageCount ?? 1 }, (_, index) => ({
      page: index + 1, status: 'passed' as const,
      expected: `Page ${index + 1} is complete.`, observed: `Page ${index + 1} is complete.`, evidence: `Inspected the old PDF, page ${index + 1}.`,
    }))

    await expect(submitPaperTaskFormatInspection({
      root, branch: 'translation', format: 'pdf', markdown: changedMaster, masterQuality: 'complete',
      inspection: { artifactSha256, expectedPageCount: pages.length, pages },
    })).rejects.toThrow('inspected PDF artifact has changed')
  })

  it('invalidates a previously built final artifact when the approved master changes', async () => {
    const root = workspace('translation')
    await buildPaperTaskFormat({ root, branch: 'translation', format: 'markdown', markdown: MARKDOWN, assets: [], masterQuality: 'complete' })

    expect(readPaperTaskFormatStatus(root, 'translation', 'markdown', `${MARKDOWN}\n\n已修改。`, 'complete').status).toBe('failed')
    expect(readPaperTaskArtifact({ root, branch: 'translation', format: 'markdown', markdown: `${MARKDOWN}\n\n已修改。`, masterQuality: 'complete' })).toBeUndefined()
  })

  it('marks changed output bytes failed without changing the independent Markdown artifact', async () => {
    const root = workspace('translation')
    await buildPaperTaskFormat({ root, branch: 'translation', format: 'markdown', markdown: MARKDOWN, assets: [], masterQuality: 'complete' })
    await buildPaperTaskFormat({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, assets: [], masterQuality: 'complete' })
    writeFileSync(join(root, 'drafts', 'translation', 'translated.pdf'), Buffer.from('not a PDF'))

    expect(readPaperTaskFormatStatus(root, 'translation', 'pdf', MARKDOWN, 'complete').status).toBe('failed')
    expect(readPaperTaskArtifact({ root, branch: 'translation', format: 'pdf', markdown: MARKDOWN, masterQuality: 'complete' })).toBeUndefined()
    expect(readPaperTaskArtifact({ root, branch: 'translation', format: 'markdown', markdown: MARKDOWN, masterQuality: 'complete' })).toEqual(Buffer.from(MARKDOWN))
  })
})

function workspace(branch: 'translation' | 'deep-reading'): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-artifact-export-'))
  ROOTS.push(root)
  mkdirSync(join(root, 'drafts', branch), { recursive: true })
  return root
}
