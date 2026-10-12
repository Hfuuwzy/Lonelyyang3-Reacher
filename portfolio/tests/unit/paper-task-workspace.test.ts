/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPaperTaskWorkspace,
  removePaperTaskWorkspace,
  saveDraft,
  saveWorkContext,
  workspacePaths,
  ORIGINAL_PDF_NAME,
  WORK_CONTEXT_NAME,
} from '../../server/paper-task/workspace'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])

let roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-workspace-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
  roots = []
})

describe('paper-task workspace layout', () => {
  it('creates the retained tree with the original PDF and an assets dir', () => {
    // Given: a fresh task root and PDF bytes.
    const root = tempRoot()
    const paths = workspacePaths(root)

    // When: the workspace is created.
    createPaperTaskWorkspace(root, PDF_BYTES)

    // Then: the original PDF and both directories exist, drafts is empty.
    expect(existsSync(paths.originalPath)).toBe(true)
    expect(new Uint8Array(readFileSync(paths.originalPath))).toEqual(PDF_BYTES)
    expect(statSync(paths.draftsDir).isDirectory()).toBe(true)
    expect(statSync(paths.assetsDir).isDirectory()).toBe(true)
    expect(readdirSync(paths.draftsDir).sort()).toEqual(['deep-reading', 'translation'])
    expect(readdirSync(paths.branchDirectories.translation)).toEqual(['pieces'])
    expect(readdirSync(paths.branchDirectories['deep-reading'])).toEqual(['pieces'])
    expect(readdirSync(root).sort()).toEqual(['assets', 'drafts', ORIGINAL_PDF_NAME, 'source-records'])
  })

  it('persists a minimal work context and per-branch drafts', () => {
    // Given: a created workspace.
    const root = tempRoot()
    createPaperTaskWorkspace(root, PDF_BYTES)
    const paths = workspacePaths(root)

    // When: work context and drafts are saved.
    saveWorkContext(root, {
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      selection: 'both',
      pageCount: 2,
      sourceRecordsDir: paths.sourceRecordsDir,
      assetsDir: paths.assetsDir,
      sourceStatePath: paths.sourceStatePath,
    })
    saveDraft(root, 'translation', { designation: 'sample', paragraphs: ['样例段落'] })
    saveDraft(root, 'deep-reading', { designation: 'sample', paragraphs: ['深读样例'] })

    // Then: each file exists with the exact payload.
    const context = JSON.parse(readFileSync(paths.workContextPath, 'utf8')) as Record<string, unknown>
    expect(context).toEqual({
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      selection: 'both',
      pageCount: 2,
      sourceRecordsDir: paths.sourceRecordsDir,
      assetsDir: paths.assetsDir,
      sourceStatePath: paths.sourceStatePath,
    })
    expect(readdirSync(paths.branchDirectories.translation).sort()).toEqual(['draft.json', 'pieces'])
    expect(readdirSync(paths.branchDirectories['deep-reading']).sort()).toEqual(['draft.json', 'pieces'])
    expect(JSON.parse(readFileSync(join(paths.branchDirectories.translation, 'draft.json'), 'utf8'))).toEqual({
      designation: 'sample',
      paragraphs: ['样例段落'],
    })
  })

  it('overwrites a draft for the same branch', () => {
    // Given: a created workspace with one draft.
    const root = tempRoot()
    createPaperTaskWorkspace(root, PDF_BYTES)

    // When: the same branch draft is saved again.
    saveDraft(root, 'translation', { paragraphs: ['第一版'] })
    saveDraft(root, 'translation', { paragraphs: ['第二版'] })

    // Then: only the latest payload is retained.
    const payload = JSON.parse(readFileSync(join(workspacePaths(root).branchDirectories.translation, 'draft.json'), 'utf8'))
    expect(payload).toEqual({ paragraphs: ['第二版'] })
  })

  it('removes the whole retained workspace', () => {
    // Given: a populated workspace.
    const root = tempRoot()
    createPaperTaskWorkspace(root, PDF_BYTES)
    saveDraft(root, 'translation', { paragraphs: ['x'] })

    // When: the workspace is removed.
    removePaperTaskWorkspace(root)

    // Then: nothing remains under the task root.
    expect(existsSync(root)).toBe(false)
  })
})
