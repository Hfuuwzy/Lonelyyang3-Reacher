/**
 * Project-local retained workspace for one sample paper task (issue #40).
 *
 * Every task owns a directory under `<projectRoot>/project-local/<uuid>` that
 * holds the original PDF, a minimal work-context JSON, per-branch draft
 * outputs, and an assets directory. These materials are retained without a TTL
 * until the task is deleted; the coordinator removes the directory only after
 * runtime cleanup has succeeded.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PaperTaskBranch, PaperTaskSelection } from '../../app/utils/paper-task-contract'

export const ORIGINAL_PDF_NAME = 'original.pdf'
export const WORK_CONTEXT_NAME = 'work-context.json'
export const SOURCE_RECORDS_DIR = 'source-records'
export const SOURCE_STATE_NAME = 'source-state.json'

export interface PaperTaskWorkspacePaths {
  readonly root: string
  readonly originalPath: string
  readonly workContextPath: string
  readonly draftsDir: string
  readonly assetsDir: string
  readonly sourceRecordsDir: string
  readonly sourceStatePath: string
  readonly branchDirectories: Readonly<Record<'translation' | 'deep-reading', string>>
}

/** Layout paths for a task workspace rooted at `root`. */
export function workspacePaths(root: string): PaperTaskWorkspacePaths {
  return {
    root,
    originalPath: join(root, ORIGINAL_PDF_NAME),
    workContextPath: join(root, WORK_CONTEXT_NAME),
    draftsDir: join(root, 'drafts'),
    assetsDir: join(root, 'assets'),
    sourceRecordsDir: join(root, SOURCE_RECORDS_DIR),
    sourceStatePath: join(root, SOURCE_STATE_NAME),
    branchDirectories: {
      translation: join(root, 'drafts', 'translation'),
      'deep-reading': join(root, 'drafts', 'deep-reading'),
    },
  }
}

export interface PaperTaskWorkContext {
  readonly taskId: string
  readonly selection: PaperTaskSelection
  readonly pageCount: number
  readonly sourceRecordsDir: string
  readonly assetsDir: string
  readonly sourceStatePath: string
}

export type DraftPieceMetadata = {
  readonly id: string
  readonly dependencies: readonly { readonly recordId: string; readonly revision: number }[]
  readonly stale: boolean
}

/**
 * Create the workspace directory tree and persist the original PDF. Throws on
 * any filesystem failure so the boundary maps it to a safe fixed error.
 */
export function createPaperTaskWorkspace(
  root: string,
  originalPdf: Uint8Array,
): PaperTaskWorkspacePaths {
  const paths = workspacePaths(root)
  mkdirSync(paths.draftsDir, { recursive: true })
  mkdirSync(paths.assetsDir, { recursive: true })
  mkdirSync(paths.sourceRecordsDir, { recursive: true })
  mkdirSync(join(paths.branchDirectories.translation, 'pieces'), { recursive: true })
  mkdirSync(join(paths.branchDirectories['deep-reading'], 'pieces'), { recursive: true })
  writeFileSync(paths.originalPath, originalPdf)
  return paths
}

/** Persist the minimal work context after page extraction. */
export function saveWorkContext(root: string, workContext: PaperTaskWorkContext): void {
  writeFileSync(workspacePaths(root).workContextPath, JSON.stringify(workContext))
}

/** Persist one branch's sample draft output as `drafts/<branch>.json`. */
export function saveDraft(root: string, branch: PaperTaskBranch, payload: unknown): void {
  writeFileSync(join(workspacePaths(root).branchDirectories[branch], 'draft.json'), JSON.stringify(payload))
}

export function saveGeneratedPreview(root: string, branch: PaperTaskBranch, markdown: string): void {
  writeFileSync(join(workspacePaths(root).branchDirectories[branch], 'preview.md'), markdown, { mode: 0o600 })
}

export function saveDraftPiece(root: string, branch: PaperTaskBranch, piece: DraftPieceMetadata): void {
  const directory = join(workspacePaths(root).branchDirectories[branch], 'pieces')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${piece.id}.json`), JSON.stringify(piece))
}


/** Remove the whole retained workspace; intended to run only after cleanup. */
export function removePaperTaskWorkspace(root: string): void {
  rmSync(root, { recursive: true, force: true })
}
