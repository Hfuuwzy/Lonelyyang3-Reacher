/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSampleProcessRuntimeFactory } from '../../server/paper-task/runtime'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-isolation-'))
  roots.push(root)
  return root
}

describe('paper-task worker filesystem isolation', () => {
  it('permits only context and shared source reads plus writes in its retained branch workspace', async () => {
    const root = tempRoot()
    const sharedSources = join(root, 'shared-sources')
    const branchWorkspaceDir = join(root, 'translation-branch')
    const siblingWorkspace = join(root, 'deep-reading-branch')
    const runtimeHome = join(root, 'runtime-home')
    const workContextPath = join(root, 'context.json')
    const sourceFile = join(sharedSources, 'record.txt')
    const unrelatedPath = join(root, 'unrelated.txt')
    mkdirSync(sharedSources)
    mkdirSync(branchWorkspaceDir)
    mkdirSync(siblingWorkspace)
    writeFileSync(workContextPath, JSON.stringify({
      sourcePath: sourceFile,
      sourceDirectory: sharedSources,
      siblingDirectory: siblingWorkspace,
      unrelatedPath,
      branchDirectory: branchWorkspaceDir,
    }))
    writeFileSync(sourceFile, 'shared source')
    writeFileSync(join(siblingWorkspace, 'private.txt'), 'sibling')
    writeFileSync(unrelatedPath, 'unrelated')

    const runtime = createSampleProcessRuntimeFactory({
      workerPath: join(process.cwd(), 'tests', 'fixtures', 'paper-task-isolation-worker.mjs'),
    })({
      branch: 'translation',
      runtimeHome,
      workContextPath,
      sourceReadPaths: [sourceFile, sharedSources],
      branchWorkspaceDir,
    })

    const events = []
    for await (const event of runtime.events()) {
      events.push(event)
    }

    expect(await runtime.result).toEqual({ ok: true })
    const preview = events.find((event) => event.type === 'preview')
    expect(preview?.type).toBe('preview')
    if (preview?.type !== 'preview') {
      throw new Error('worker did not emit an isolation preview')
    }
    expect(JSON.parse(preview.paragraphs[0] ?? '{}')).toEqual({
      contextRead: 'allowed',
      sourceRead: 'allowed',
      sourceDirectoryRead: 'allowed',
      sourceWrite: 'denied',
      siblingRead: 'denied',
      siblingWrite: 'denied',
      unrelatedRead: 'denied',
      branchWrite: 'allowed',
      branchRead: 'allowed',
      childSpawn: 'denied',
    })
    expect(readFileSync(sourceFile, 'utf8')).toBe('shared source')
    expect(existsSync(join(branchWorkspaceDir, 'result.txt'))).toBe(true)
    expect(await runtime.close()).toEqual({ ok: true })
  })
})
