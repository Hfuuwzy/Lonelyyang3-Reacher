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

export const ORIGINAL_PDF_NAME = 'original.pdf'
export const WORK_CONTEXT_NAME = 'work-context.json'

export interface PaperTaskWorkspacePaths {
  readonly root: string
  readonly originalPath: string
  readonly workContextPath: string
  readonly draftsDir: string
  readonly assetsDir: string
}

/** Layout paths for a task workspace rooted at `root`. */
export function workspacePaths(root: string): PaperTaskWorkspacePaths {
  return {
    root,
    originalPath: join(root, ORIGINAL_PDF_NAME),
    workContextPath: join(root, WORK_CONTEXT_NAME),
    draftsDir: join(root, 'drafts'),
    assetsDir: join(root, 'assets'),
  }
}

export interface PaperTaskWorkContext {
  readonly taskId: string
  readonly selection: string
  readonly pageCount: number
  readonly sourceExcerpt: string
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
  writeFileSync(paths.originalPath, originalPdf)
  return paths
}

/** Persist the minimal work context after page extraction. */
export function saveWorkContext(root: string, workContext: PaperTaskWorkContext): void {
  writeFileSync(workspacePaths(root).workContextPath, JSON.stringify(workContext))
}

/** Persist one branch's sample draft output as `drafts/<branch>.json`. */
export function saveDraft(root: string, branch: string, payload: unknown): void {
  writeFileSync(join(workspacePaths(root).draftsDir, `${branch}.json`), JSON.stringify(payload))
}

/** Remove the whole retained workspace; intended to run only after cleanup. */
export function removePaperTaskWorkspace(root: string): void {
  rmSync(root, { recursive: true, force: true })
}