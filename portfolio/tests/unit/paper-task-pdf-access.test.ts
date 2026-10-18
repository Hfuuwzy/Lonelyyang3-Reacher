/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readPaperTaskOriginalPdf,
  readPaperTaskTranslatedPdf,
} from '../../server/paper-task/pdf-access'

const MASTER = '# 标题\n\n正文。'
const PDF = new Uint8Array(Buffer.from('%PDF-1.4\ntranslated body\n'))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('translated PDF availability', () => {
  it('serves only a built PDF that matches the approved master and every page check', () => {
    const root = fixture()
    expect(readPaperTaskTranslatedPdf(root, 'complete')).toEqual(PDF)
  })

  it('refuses a PDF while the master is not complete', () => {
    const root = fixture()
    for (const quality of ['preview', 'needs-confirmation', 'failed'] as const) {
      expect(readPaperTaskTranslatedPdf(root, quality)).toBeUndefined()
    }
  })

  it('refuses an unbuilt artifact or an incomplete page check', () => {
    const unbuilt = fixture({ build: 'unbuilt' })
    expect(readPaperTaskTranslatedPdf(unbuilt, 'complete')).toBeUndefined()
    const blocked = fixture({ pageStatus: 'blocked' })
    expect(readPaperTaskTranslatedPdf(blocked, 'complete')).toBeUndefined()
    const missingPage = fixture({ pages: [] })
    expect(readPaperTaskTranslatedPdf(missingPage, 'complete')).toBeUndefined()
  })

  it('refuses an artifact that does not match the approved master', () => {
    const root = fixture({ artifactMasterSha256: '0'.repeat(64) })
    expect(readPaperTaskTranslatedPdf(root, 'complete')).toBeUndefined()
  })

  it('refuses a missing or non-PDF artifact', () => {
    const missing = fixture({ writePdf: false })
    expect(readPaperTaskTranslatedPdf(missing, 'complete')).toBeUndefined()
    const notPdf = fixture({ pdf: new Uint8Array(Buffer.from('not a pdf')) })
    expect(readPaperTaskTranslatedPdf(notPdf, 'complete')).toBeUndefined()
  })
})

describe('original PDF retrieval', () => {
  it('returns the retained original PDF bytes', () => {
    const root = fixture()
    expect(readPaperTaskOriginalPdf(root)).toEqual(PDF)
  })

  it('returns undefined when the retained original is missing', () => {
    const root = fixture({ writeOriginal: false })
    expect(readPaperTaskOriginalPdf(root)).toBeUndefined()
  })
})

function fixture(overrides: {
  readonly build?: 'built' | 'unbuilt' | 'failed'
  readonly pageStatus?: 'passed' | 'minor' | 'blocked'
  readonly pages?: readonly { readonly page: number; readonly status: 'passed' | 'minor' | 'blocked' }[]
  readonly artifactMasterSha256?: string
  readonly writePdf?: boolean
  readonly writeOriginal?: boolean
  readonly pdf?: Uint8Array
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-pdf-'))
  roots.push(root)
  const translation = join(root, 'drafts', 'translation')
  mkdirSync(translation, { recursive: true })
  const sha = createHash('sha256').update(MASTER).digest('hex')
  writeFileSync(join(translation, 'master.md'), MASTER)
  writeFileSync(join(translation, 'preview.md'), MASTER)
  writeFileSync(join(translation, 'translation.json'), JSON.stringify({
    status: 'complete',
    masterSha256: sha,
    segments: [{ index: 0, stale: false }],
    assets: [],
    unresolved: [],
  }))
  writeFileSync(join(translation, 'pdf-format.json'), JSON.stringify({
    format: 'pdf',
    build: overrides.build ?? 'built',
    sourceMasterSha256: sha,
    artifactMasterSha256: overrides.artifactMasterSha256 ?? sha,
    expectedPageCount: 1,
    pages: overrides.pages ?? [{ page: 1, status: overrides.pageStatus ?? 'passed' }],
  }))
  if (overrides.writePdf !== false) {
    writeFileSync(join(translation, 'translated.pdf'), overrides.pdf ?? PDF)
  }
  if (overrides.writeOriginal !== false) {
    writeFileSync(join(root, 'original.pdf'), PDF)
  }
  return root
}
