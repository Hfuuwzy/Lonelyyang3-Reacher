import { describe, expect, it } from 'vitest'
import {
  paperTaskSourceAssetPath,
  paperTaskSourceTaskIdSchema,
  paperTaskSourceViewPath,
  projectPaperTaskSourceView,
} from '../../app/utils/paper-task-source-view'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const OTHER_TASK_ID = '123e4567-e89b-12d3-a456-426614174001'

const SOURCE_VIEW = {
  taskId: TASK_ID,
  state: 'incomplete',
  gaps: [{ id: 'gap-1', reason: '原文页面未能读取。' }],
  assets: [{
    id: 'table-figure-2',
    kind: 'table',
    caption: 'Table 2. Results',
    availability: 'available',
    understanding: 'unverified',
    inputs: [],
  }],
}

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...SOURCE_VIEW, ...overrides }
}

describe('paper task source view projection', () => {
  it('derives the GET route from a validated task UUID', () => {
    // Given a validated task UUID.
    const taskId = paperTaskSourceTaskIdSchema.parse(TASK_ID)

    // When the source-view route is projected.
    const path = paperTaskSourceViewPath(taskId)

    // Then it addresses the task-local source projection endpoint.
    expect(path).toBe(`/api/prototype/paper-task/${TASK_ID}/source`)
  })

  it('parses a bounded reader projection for the expected task', () => {
    // Given a response using the exact reader-facing source shape.
    const payload = response()

    // When it is projected for the task that requested it.
    const view = projectPaperTaskSourceView(payload, TASK_ID)

    // Then only the validated source view is adopted.
    expect(view).toEqual(SOURCE_VIEW)
    expect(view?.gaps[0]?.reason).toBe('原文页面未能读取。')
  })

  it('rejects an input receipt that names a different asset', () => {
    // Given an asset whose input receipt references another asset id.
    const payload = response({
      assets: [{
        ...SOURCE_VIEW.assets[0],
        id: 'asset-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        inputs: [{
          branch: 'translation', assetId: 'asset-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          recordId: 'p1-r0', revision: 1, status: 'transported', reason: null,
        }],
      }],
    })

    // When the source view is projected.
    const view = projectPaperTaskSourceView(payload, TASK_ID)

    // Then the foreign nested reference is rejected.
    expect(view).toBeNull()
  })

  it('rejects two input receipts for the same branch', () => {
    // Given an asset with two otherwise-valid receipts for its own id and branch.
    const assetId = 'asset-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const payload = response({
      assets: [{
        ...SOURCE_VIEW.assets[0],
        id: assetId,
        inputs: ['p1-r0', 'p2-r0'].map((recordId) => ({
          branch: 'translation', assetId, recordId, revision: 1, status: 'transported', reason: null,
        })),
      }],
    })

    // When the source view is projected.
    const view = projectPaperTaskSourceView(payload, TASK_ID)

    // Then duplicate branch evidence is rejected.
    expect(view).toBeNull()
  })

  it('rejects a valid response that belongs to a different task', () => {
    // Given a source view with a different valid task UUID.
    const payload = response({ taskId: OTHER_TASK_ID })

    // When it is projected for the current task.
    const view = projectPaperTaskSourceView(payload, TASK_ID)

    // Then no foreign task materials are returned.
    expect(view).toBeNull()
  })

  it.each([
    ['path traversal', '../table'],
    ['uppercase characters', 'Table-2'],
    ['a slash', 'table/2'],
    ['a URL', 'https://example.test/table.png'],
    ['a trailing separator', 'table-'],
  ])('rejects an asset id containing %s', (_label, assetId) => {
    // Given an untrusted asset id that cannot be a single safe path segment.
    const payload = response({
      assets: [{ ...SOURCE_VIEW.assets[0], id: assetId }],
    })

    // When the view is parsed.
    const view = projectPaperTaskSourceView(payload, TASK_ID)

    // Then the whole response is rejected.
    expect(view).toBeNull()
  })

  it('rejects untrusted URL fields instead of accepting source-provided URLs', () => {
    // Given asset and root objects that attempt to supply arbitrary image URLs.
    const payload = response({
      url: 'https://example.test/attacker.png',
      assets: [{ ...SOURCE_VIEW.assets[0], url: 'https://example.test/asset.png' }],
    })

    // When the view is parsed.
    const view = projectPaperTaskSourceView(payload, TASK_ID)

    // Then strict object schemas reject both URL injection points.
    expect(view).toBeNull()
  })

  it('rejects a malformed expected task id before adopting a response', () => {
    // Given a valid response and a malformed request identity.
    const payload = response()

    // When the view is projected for a non-UUID task id.
    const view = projectPaperTaskSourceView(payload, 'not-a-uuid')

    // Then the response is not associated with an invalid task.
    expect(view).toBeNull()
  })

  it('rejects a gap reason longer than 500 characters', () => {
    // Given a gap explanation beyond the documented bound.
    const payload = response({ gaps: [{ id: 'gap-1', reason: 'x'.repeat(501) }] })

    // When the view is parsed.
    const view = projectPaperTaskSourceView(payload, TASK_ID)

    // Then the unbounded explanation is not adopted.
    expect(view).toBeNull()
  })

  it('rejects an asset caption longer than 500 characters', () => {
    // Given an asset caption beyond the documented bound.
    const payload = response({
      assets: [{ ...SOURCE_VIEW.assets[0], caption: 'x'.repeat(501) }],
    })

    // When the view is parsed.
    const view = projectPaperTaskSourceView(payload, TASK_ID)

    // Then the unbounded caption is not adopted.
    expect(view).toBeNull()
  })

  it('rejects more than 100 gaps or assets', () => {
    // Given each collection exceeding its 100-entry bound.
    const tooManyGaps = response({
      gaps: Array.from({ length: 101 }, (_, index) => ({ id: `gap-${index}`, reason: 'missing source' })),
    })
    const tooManyAssets = response({
      assets: Array.from({ length: 101 }, (_, index) => ({
        ...SOURCE_VIEW.assets[0], id: `table-${index}`,
      })),
    })

    // When either response is parsed.
    const parsedGaps = projectPaperTaskSourceView(tooManyGaps, TASK_ID)
    const parsedAssets = projectPaperTaskSourceView(tooManyAssets, TASK_ID)

    // Then neither oversized projection enters the reader.
    expect(parsedGaps).toBeNull()
    expect(parsedAssets).toBeNull()
  })

  it('builds image paths only from validated task and asset ids', () => {
    // Given a parsed view with an available original crop.
    const view = projectPaperTaskSourceView(response(), TASK_ID)
    if (view === null) {
      throw new Error('expected the source view fixture to parse')
    }
    const asset = view.assets[0]
    if (asset === undefined) {
      throw new Error('expected the source view fixture to contain an asset')
    }

    // When the component requests that crop's same-origin route.
    const path = paperTaskSourceAssetPath(view.taskId, asset.id)

    // Then the path is derived from validated identifiers, not response URLs.
    expect(path).toBe(`/api/prototype/paper-task/${TASK_ID}/assets/table-figure-2`)
  })
})
