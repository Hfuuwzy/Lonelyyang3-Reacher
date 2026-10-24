/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preparedExtractionFixture } from '../fixtures/paper-task-source'
import { createPaperTaskService } from '../../server/paper-task/coordinator'
import type { PaperTaskRuntimeFactory } from '../../server/paper-task/runtime'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'
import type { PaperTaskMultipartInput } from '../../server/paper-task/multipart'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.4\nfragment fixture'))
const FRAGMENT = '# 保存的译文片段\n\n这段内容只存在于任务分支的预览文件中。'
const SIBLING = '# 深读完整报告\n\n另一分支的完整主稿仍然可读。'
const NORMAL_MASTER = '# 完整译文主稿\n\n正常完成并写入主稿的内容。'
const CANONICAL_WITHOUT_PREVIEW = '# 已落盘的主稿\n\n正式预览镜像和元数据写入前，服务已经重启。'
const roots: string[] = []

function input(): PaperTaskMultipartInput {
  return { pdf: PDF_BYTES, selection: 'both' }
}

async function collect(events: AsyncIterable<PaperTaskEvent>): Promise<readonly PaperTaskEvent[]> {
  const collected: PaperTaskEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

function mixedBranchRuntime(): PaperTaskRuntimeFactory {
  return (options) => {
    const branch = options.branch
    const directory = options.branchWorkspaceDir
    if (directory === undefined) throw new Error('branch workspace unavailable')

    if (branch === 'deep-reading') {
      writeFileSync(join(directory, 'report.md'), SIBLING)
      writeFileSync(join(directory, 'preview.md'), SIBLING)
      writeFileSync(join(directory, 'evidence.json'), JSON.stringify({
        manuscriptSha256: createHash('sha256').update(SIBLING).digest('hex'),
        status: 'preview',
        claims: [],
        assets: [],
        uncompletedReasons: [],
        unresolvedRecordIds: [],
        unverifiedAssetIds: [],
      }))
    }

    return {
      events: async function* () {
        yield {
          type: 'generated-preview',
          markdown: branch === 'translation' ? FRAGMENT : SIBLING,
          paragraphs: [branch === 'translation' ? '这段内容只存在于任务分支的预览文件中。' : '另一分支的完整主稿仍然可读。'],
          quality: branch === 'translation'
            ? { status: 'needs-confirmation', issues: ['尚未发布分支主稿'], options: ['inspect-source'] }
            : { status: 'complete', issues: [], options: [] },
        }
      },
      result: Promise.resolve({ ok: branch === 'deep-reading' }),
      close: async () => ({ ok: true }),
    }
  }
}

function completedTranslationRuntime(): PaperTaskRuntimeFactory {
  return (options) => {
    const directory = options.branchWorkspaceDir
    if (directory === undefined) throw new Error('branch workspace unavailable')
    writeFileSync(join(directory, 'master.md'), NORMAL_MASTER)
    writeFileSync(join(directory, 'translation.json'), JSON.stringify({
      version: 1,
      status: 'complete',
      sourceRevision: 1,
      masterSha256: createHash('sha256').update(NORMAL_MASTER).digest('hex'),
      segments: [{
        index: 0,
        markdown: NORMAL_MASTER,
        stale: false,
        dependencies: [{ recordId: 'p1-r0', revision: 1 }, { recordId: 'p1-r1', revision: 1 }],
      }],
      assets: [],
      unresolved: [],
    }))
    return {
      events: async function* () {
        yield {
          type: 'generated-preview',
          markdown: NORMAL_MASTER,
          paragraphs: ['正常完成并写入主稿的内容。'],
          quality: { status: 'complete', issues: [], options: [] },
        }
      },
      result: Promise.resolve({ ok: true }),
      close: async () => ({ ok: true }),
    }
  }
}

function canonicalTranslationWithoutPreviewRuntime(): PaperTaskRuntimeFactory {
  return (options) => {
    const directory = options.branchWorkspaceDir
    if (directory === undefined) throw new Error('branch workspace unavailable')
    writeFileSync(join(directory, 'master.md'), CANONICAL_WITHOUT_PREVIEW)
    return {
      events: async function* () {
        yield { type: 'preview', paragraphs: ['任务样例，不是分支主稿。'], pieces: [] }
      },
      result: Promise.resolve({ ok: true }),
      close: async () => ({ ok: true }),
    }
  }
}

function hangingTranslationRuntime(): PaperTaskRuntimeFactory {
  return () => {
    let release!: () => void
    let resolveResult!: (result: { readonly ok: boolean }) => void
    const released = new Promise<void>((resolve) => { release = resolve })
    const result = new Promise<{ readonly ok: boolean }>((resolve) => { resolveResult = resolve })
    return {
      events: async function* () {
        yield {
          type: 'generated-preview',
          markdown: FRAGMENT,
          paragraphs: ['这段内容只存在于任务分支的预览文件中。'],
          quality: { status: 'needs-confirmation', issues: ['任务尚未结束'], options: ['inspect-source'] },
        }
        await released
      },
      result,
      close: async () => {
        release()
        resolveResult({ ok: false })
        return { ok: true }
      },
    }
  }
}

async function nextWithin<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timed out waiting for task preview')), 3000)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function preparedSource() {
  return preparedExtractionFixture({
    success: true,
    pageCount: 1,
    pages: [{
      readerPage: 1,
      lines: [{ text: 'fixture heading', isHeading: true }],
      headings: ['fixture heading'],
      text: 'fixture heading\nauthored content line',
    }],
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('persisted paper-task fragments through the public service', () => {
  it('returns a task-bound fragment beside a readable sibling master and exposes the same identity in history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-fragment-'))
    roots.push(root)
    const service = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: mixedBranchRuntime(),
      prepareSource: async () => preparedSource(),
      createId: () => TASK_ID,
    })
    const submission = await service.submit(input())
    if (!submission.ok) throw new Error('task submission failed')
    await collect(submission.events)

    const view = service.reader(TASK_ID)
    expect(view?.documents).toHaveLength(2)
    const fragment = view?.documents.find((document) => document.branch === 'translation')
    expect(fragment).toMatchObject({
      branch: 'translation',
      status: 'fragment',
      markdown: FRAGMENT,
      fragment: {
        taskId: TASK_ID,
        branch: 'translation',
        identity: `sha256:${createHash('sha256').update(FRAGMENT).digest('hex')}`,
        source: 'drafts/translation/preview.md',
        reason: 'branch-failed',
        quality: {
          status: 'needs-confirmation',
          issues: ['尚未发布分支主稿'],
          options: ['inspect-source'],
        },
      },
    })
    expect(view?.documents.find((document) => document.branch === 'deep-reading')).toMatchObject({
      status: 'complete',
      markdown: SIBLING,
    })
    expect(service.history()[0]).toMatchObject({
      taskId: TASK_ID,
      branches: { translation: 'failed', 'deep-reading': 'complete' },
      fragments: [fragment?.fragment],
    })
    expect(await service.buildArtifacts(TASK_ID, 'translation', ['markdown', 'pdf'])).toBeUndefined()
    expect(service.artifact(TASK_ID, 'translation', 'markdown')).toBeUndefined()
    expect(service.translatedPdf(TASK_ID)).toBeUndefined()
  })

  it('keeps a normal published master on its ordinary reader path without inventing fragment metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-fragment-normal-'))
    roots.push(root)
    const service = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: completedTranslationRuntime(),
      prepareSource: async () => preparedSource(),
      createId: () => TASK_ID,
    })
    const submission = await service.submit({ pdf: PDF_BYTES, selection: 'translation' })
    if (!submission.ok) throw new Error('completed task submission failed')
    await collect(submission.events)

    expect(service.reader(TASK_ID)?.documents).toMatchObject([{
      branch: 'translation',
      status: 'complete',
      markdown: NORMAL_MASTER,
    }])
    expect(service.reader(TASK_ID)?.documents[0]).not.toHaveProperty('fragment')
    expect(service.history()[0]).not.toHaveProperty('fragments')
  })

  it('reconstructs the same fragment identity and quality from retained branch files after service restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-fragment-restart-'))
    roots.push(root)
    const original = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: mixedBranchRuntime(),
      prepareSource: async () => preparedSource(),
      createId: () => TASK_ID,
    })
    const submission = await original.submit(input(), { sourceTitle: 'retained-fragment.pdf' })
    if (!submission.ok) throw new Error('task submission failed')
    await collect(submission.events)
    const originalReader = original.reader(TASK_ID)
    const originalHistory = original.history()

    let runtimeStarts = 0
    const restored = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: () => {
        runtimeStarts += 1
        throw new Error('recovery must not start a runtime')
      },
    })

    expect(restored.reader(TASK_ID)).toEqual(originalReader)
    expect(restored.history()).toEqual(originalHistory)
    expect(restored.history()[0]?.fragments).toEqual(originalHistory[0]?.fragments)
    const replayed = await collect(restored.events(TASK_ID)!)
    expect(replayed.at(-1)).toMatchObject({
      type: 'terminal',
      outcome: 'failed',
      taskId: TASK_ID,
      branches: { translation: 'failed', 'deep-reading': 'complete' },
    })
    expect(runtimeStarts).toBe(0)
  })

  it('recovers a branch-local canonical body as an explicit fragment after restart when its preview mirror is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-canonical-fragment-restart-'))
    roots.push(root)
    const original = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: canonicalTranslationWithoutPreviewRuntime(),
      prepareSource: async () => preparedSource(),
      createId: () => TASK_ID,
    })
    const submission = await original.submit({ pdf: PDF_BYTES, selection: 'translation' })
    if (!submission.ok) throw new Error('task submission failed')
    await collect(submission.events)

    const previewPath = join(root, 'project-local', TASK_ID, 'drafts', 'translation', 'preview.md')
    const canonicalPath = join(root, 'project-local', TASK_ID, 'drafts', 'translation', 'master.md')
    expect(existsSync(previewPath)).toBe(false)
    expect(existsSync(canonicalPath)).toBe(true)

    let runtimeStarts = 0
    const restored = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: () => {
        runtimeStarts += 1
        throw new Error('recovery must not start a runtime')
      },
    })
    const document = restored.reader(TASK_ID)?.documents[0]
    expect(document).toMatchObject({
      branch: 'translation',
      status: 'fragment',
      markdown: CANONICAL_WITHOUT_PREVIEW,
      fragment: {
        taskId: TASK_ID,
        branch: 'translation',
        identity: `sha256:${createHash('sha256').update(CANONICAL_WITHOUT_PREVIEW).digest('hex')}`,
        source: 'drafts/translation/master.md',
        reason: 'result-not-published',
      },
    })
    expect(document?.status).not.toBe('complete')
    expect(restored.history()[0]?.fragments).toEqual([document?.status === 'fragment' ? document.fragment : undefined])
    expect(runtimeStarts).toBe(0)
  })

  it('returns no fragment for a failed branch when its preview was never persisted or is unreadable', async () => {
    const missingRoot = mkdtempSync(join(tmpdir(), 'paper-task-fragment-missing-'))
    const unreadableRoot = mkdtempSync(join(tmpdir(), 'paper-task-fragment-unreadable-'))
    roots.push(missingRoot, unreadableRoot)
    const missingService = createPaperTaskService({
      projectRoot: missingRoot,
      runtimeFactory: () => ({
        events: async function* () {},
        result: Promise.resolve({ ok: false }),
        close: async () => ({ ok: true }),
      }),
      prepareSource: async () => preparedSource(),
      createId: () => TASK_ID,
    })
    const missingSubmission = await missingService.submit({ pdf: PDF_BYTES, selection: 'translation' })
    if (!missingSubmission.ok) throw new Error('missing-preview task submission failed')
    await collect(missingSubmission.events)

    const unreadableService = createPaperTaskService({
      projectRoot: unreadableRoot,
      runtimeFactory: mixedBranchRuntime(),
      prepareSource: async () => preparedSource(),
      createId: () => TASK_ID,
    })
    const unreadableSubmission = await unreadableService.submit({ pdf: PDF_BYTES, selection: 'translation' })
    if (!unreadableSubmission.ok) throw new Error('unreadable-preview task submission failed')
    await collect(unreadableSubmission.events)
    writeFileSync(join(unreadableRoot, 'project-local', TASK_ID, 'drafts', 'translation', 'preview.md'), new Uint8Array([0xff, 0xfe]))

    expect(missingService.reader(TASK_ID)?.documents).toEqual([])
    expect(missingService.history()[0]).not.toHaveProperty('fragments')
    expect(unreadableService.reader(TASK_ID)?.documents).toEqual([])
    expect(unreadableService.history()[0]).not.toHaveProperty('fragments')
  })

  it('keeps fragment identity when the user stops after a preview was persisted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-fragment-stopped-'))
    roots.push(root)
    const service = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: hangingTranslationRuntime(),
      prepareSource: async () => preparedSource(),
      createId: () => TASK_ID,
    })
    const submission = await service.submit({ pdf: PDF_BYTES, selection: 'translation' })
    if (!submission.ok) throw new Error('task submission failed')
    const iterator = submission.events[Symbol.asyncIterator]()
    try {
      for (;;) {
        const next = await nextWithin(iterator)
        if (next.done) throw new Error('task ended before preview')
        if (next.value.type === 'preview') break
      }
      expect(await service.cancel(TASK_ID)).toEqual({ ok: true, code: 'stopped' })

      const fragment = service.reader(TASK_ID)?.documents.find((document) => document.branch === 'translation')
      expect(fragment).toMatchObject({
        status: 'fragment',
        markdown: FRAGMENT,
        fragment: {
          taskId: TASK_ID,
          branch: 'translation',
          identity: `sha256:${createHash('sha256').update(FRAGMENT).digest('hex')}`,
          reason: 'task-stopped',
        },
      })
      expect(service.history()[0]).toMatchObject({ status: 'stopped', fragments: [fragment?.fragment] })
    } finally {
      await iterator.return?.()
    }
  })
})
