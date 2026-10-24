/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preparedExtractionFixture } from '../fixtures/paper-task-source'
import { createPaperTaskService } from '../../server/paper-task/coordinator'
import { clearPaperTaskProviderSettings, replacePaperTaskProviderSettings } from '../../server/paper-task/provider-settings'
import type { PaperTaskRuntimeFactory } from '../../server/paper-task/runtime'
import type { PaperTaskMultipartInput } from '../../server/paper-task/multipart'
import type { PaperExtractionResult, ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.4\noriginal fixture'))
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const PAGE: ExtractedPaperPage = {
  readerPage: 1,
  lines: [{ text: 'fixture heading', isHeading: true }],
  headings: ['fixture heading'],
  text: 'fixture heading\nauthored content line',
}
const EXTRACTION: PaperExtractionResult = { success: true, pageCount: 1, pages: [PAGE] }
const MARKDOWN = '# 已保存的译文主稿\n\n任务重启后仍可阅读这份完整主稿。'
const SECRET_MARKER = 'paper-task-secret-must-not-persist-6d1f'

const roots: string[] = []

function input(): PaperTaskMultipartInput {
  return { pdf: PDF_BYTES, selection: 'both' }
}

async function collect(events: AsyncIterable<PaperTaskEvent>): Promise<readonly PaperTaskEvent[]> {
  const collected: PaperTaskEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

function retainedFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? retainedFiles(path) : entry.isFile() ? [path] : []
  })
}

function completeTranslationAndFailSibling(): PaperTaskRuntimeFactory {
  return (options) => {
    const branch = options.branch
    const directory = options.branchWorkspaceDir
    if (branch === 'translation') {
      if (directory === undefined) throw new Error('branch workspace unavailable')
      writeFileSync(join(directory, 'master.md'), MARKDOWN)
      writeFileSync(join(directory, 'translation.json'), JSON.stringify({
        version: 1,
        status: 'complete',
        sourceRevision: 1,
        masterSha256: createHash('sha256').update(MARKDOWN).digest('hex'),
        segments: [{
          index: 0,
          markdown: MARKDOWN,
          stale: false,
          dependencies: [{ recordId: 'p1-r0', revision: 1 }, { recordId: 'p1-r1', revision: 1 }],
        }],
        assets: [],
        unresolved: [],
      }))
    }

    return {
      events: async function* () {
        if (branch === 'translation') {
          yield {
            type: 'generated-preview',
            markdown: MARKDOWN,
            paragraphs: ['任务重启后仍可阅读这份完整主稿。'],
            quality: { status: 'complete', issues: [], options: [] },
          }
        }
      },
      result: Promise.resolve({ ok: branch === 'translation' }),
      close: async () => ({ ok: true }),
    }
  }
}

function hangingPreviewRuntime(): PaperTaskRuntimeFactory {
  return (options) => {
    let release!: () => void
    let resolveResult!: (result: { readonly ok: boolean }) => void
    const released = new Promise<void>((resolve) => { release = resolve })
    const result = new Promise<{ readonly ok: boolean }>((resolve) => { resolveResult = resolve })
    return {
      events: async function* () {
        if (options.branch === 'translation') {
          yield {
            type: 'generated-preview',
            markdown: '# 已保存预览\n\n服务重启前已收到的内容。',
            paragraphs: ['服务重启前已收到的内容。'],
            quality: { status: 'needs-confirmation', issues: ['需要确认'], options: ['inspect-source'] },
          }
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
        timer = setTimeout(() => reject(new Error('timed out waiting for task event')), 3000)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

afterEach(() => {
  clearPaperTaskProviderSettings()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('paper-task recovery through the service boundary', () => {
  it('restores source, a readable branch, sibling failure, artifacts, and PDF gates without runtime settings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-recovery-'))
    roots.push(root)
    const prepared = preparedExtractionFixture(EXTRACTION)
    if (!prepared.success) throw new Error('source fixture failed')
    const preparedSource = {
      ...prepared,
      assets: [{
        recordId: 'p1-r0', page: 1, bbox: [0, 0, 10, 10] as const,
        availability: 'available' as const, understanding: 'unverified' as const,
        mediaType: 'image/png' as const, bytes: PNG_BYTES,
      }],
    }
    replacePaperTaskProviderSettings({
      providerLabel: 'Test provider', baseUrl: 'https://api.example.test/v1',
      protocol: 'openai-completions', model: 'test-model', imageInput: false, apiKey: SECRET_MARKER,
    })
    const service = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: completeTranslationAndFailSibling(),
      prepareSource: async () => preparedSource,
      createId: () => TASK_ID,
    })

    const submission = await service.submit(input(), { preparedSource, sourceTitle: 'persisted-paper.pdf' })
    if (!submission.ok) throw new Error('task submission failed')
    await collect(submission.events)
    await service.buildArtifacts(TASK_ID, 'translation', ['markdown', 'pdf'])
    const builtReader = service.reader(TASK_ID)
    const expectedPageCount = builtReader?.documents[0]?.formats.pdf.expectedPageCount
    const artifactSha256 = builtReader?.documents[0]?.formats.pdf.artifactSha256
    if (expectedPageCount === undefined || artifactSha256 === undefined) throw new Error('PDF artifact was not built')
    const inspectedReader = await service.inspectArtifact(TASK_ID, 'translation', 'pdf', {
      artifactSha256,
      expectedPageCount,
      pages: Array.from({ length: expectedPageCount }, (_, index) => ({
        page: index + 1,
        status: index === 0 ? 'blocked' as const : 'passed' as const,
        expected: `Page ${index + 1} preserves the translation.`,
        observed: `Page ${index + 1} was inspected.`,
        evidence: `Checked page ${index + 1}.`,
      })),
    })
    expect(service.history()[0]).toMatchObject({
      status: 'fail',
      branches: { translation: 'complete', 'deep-reading': 'failed' },
    })
    expect(inspectedReader?.documents[0]?.formats.pdf.finalAvailable).toBe(false)
    expect(inspectedReader?.documents[0]?.formats.pdf.status).toBe('needs-confirmation')
    expect(inspectedReader?.documents[0]?.formats.pdf.pages[0]?.status).toBe('blocked')
    expect(inspectedReader?.documents[0]?.formats.pdf.blockers).toContain('page-check-blocked')
    expect(retainedFiles(root).some((path) => readFileSync(path).includes(SECRET_MARKER))).toBe(false)

    const runtimeStarts = { count: 0 }
    clearPaperTaskProviderSettings()
    const restored = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: () => {
        runtimeStarts.count += 1
        throw new Error('recovery must not start a runtime')
      },
    })

    expect(restored.history()).toEqual(service.history())
    expect(restored.source(TASK_ID)?.source.records.map(({ id, revision }) => ({ id, revision }))).toEqual([
      { id: 'p1-r0', revision: 1 },
      { id: 'p1-r1', revision: 1 },
    ])
    const restoredAsset = restored.source(TASK_ID)?.assets[0]
    expect(restoredAsset).toMatchObject({ recordId: 'p1-r0', availability: 'available', understanding: 'unverified' })
    expect(restored.asset(TASK_ID, restoredAsset!.id)).toEqual(PNG_BYTES)
    expect(restored.originalPdf(TASK_ID)).toEqual(PDF_BYTES)
    expect(restored.reader(TASK_ID)).toEqual(inspectedReader)
    expect(restored.artifact(TASK_ID, 'translation', 'markdown')?.toString('utf8')).toBe(MARKDOWN)
    expect(runtimeStarts.count).toBe(0)

    const replayed = await collect(restored.events(TASK_ID)!)
    expect(replayed[0]).toEqual({ type: 'accepted', taskId: TASK_ID, selection: 'both' })
    expect(replayed.at(-1)).toMatchObject({
      type: 'terminal', outcome: 'failed',
      branches: { translation: 'complete', 'deep-reading': 'failed' },
    })
  })

  it('marks an unfinished run interrupted and replays its saved preview and terminal without starting runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-interruption-'))
    roots.push(root)
    const preparedSource = preparedExtractionFixture(EXTRACTION)
    const running = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: hangingPreviewRuntime(),
      prepareSource: async () => preparedSource,
      createId: () => TASK_ID,
    })
    const submission = await running.submit(input(), { sourceTitle: 'interrupted-paper.pdf' })
    if (!submission.ok) throw new Error('task submission failed')
    const iterator = submission.events[Symbol.asyncIterator]()
    const observed: PaperTaskEvent[] = []
    try {
      for (;;) {
        const next = await nextWithin(iterator)
        if (next.done) throw new Error('task ended before interruption')
        observed.push(next.value)
        if (next.value.type === 'preview') break
      }

      const runtimeStarts = { count: 0 }
      clearPaperTaskProviderSettings()
      const restored = createPaperTaskService({
        projectRoot: root,
        runtimeFactory: () => {
          runtimeStarts.count += 1
          throw new Error('recovery must not start a runtime')
        },
      })

      expect(restored.history()).toEqual([{
        taskId: TASK_ID,
        sourceTitle: 'interrupted-paper.pdf',
        createdAt: expect.any(String),
        selection: 'both',
        status: 'interrupted',
        branches: { translation: 'needs-confirmation', 'deep-reading': 'interrupted' },
        fragments: [{
          taskId: TASK_ID,
          branch: 'translation',
          identity: `sha256:${createHash('sha256').update('# 已保存预览\n\n服务重启前已收到的内容。').digest('hex')}`,
          source: 'drafts/translation/preview.md',
          reason: 'service-interrupted',
          quality: { status: 'needs-confirmation', issues: ['需要确认'], options: ['inspect-source'] },
        }],
      }])
      const replayed = await collect(restored.events(TASK_ID)!)
      expect(replayed.map((event) => event.type)).toEqual(['accepted', 'preview', 'terminal'])
      expect(replayed[1]).toMatchObject({
        type: 'preview', branch: 'translation', designation: 'generated-preview',
        paragraphs: ['服务重启前已收到的内容。'],
        quality: { status: 'needs-confirmation' },
      })
      expect(replayed.at(-1)).toMatchObject({
        type: 'terminal', outcome: 'interrupted',
        branches: { translation: 'needs-confirmation', 'deep-reading': 'interrupted' },
      })
      expect(runtimeStarts.count).toBe(0)
    } finally {
      await running.cancel(TASK_ID)
      await iterator.return?.()
    }
  })
})
