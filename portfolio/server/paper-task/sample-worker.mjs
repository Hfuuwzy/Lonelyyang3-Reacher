/**
 * Sample-only paper-task worker (issue #40).
 *
 * A plain Node child process that reads the task work-context JSON, emits
 * bounded `progress` / `preview` runtime events as one JSON line per stdout
 * line, and exits 0. It produces explicit example / demonstration paragraphs
 * derived from the supplied source excerpt and never pretends a translation or
 * an analysis was completed: every paragraph carries an explicit sample label.
 * No model, SDK, or paid call is involved.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const WORK_CONTEXT_PATH = process.argv[2]
const BRANCH = process.argv[3]

const MAX_PARAGRAPHS = 8
const MAX_PARAGRAPH_LENGTH = 2000
const DISPLAY_LINE_CAP = 6

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function parseWorkContext() {
  if (WORK_CONTEXT_PATH === undefined || WORK_CONTEXT_PATH === '') {
    fail('sample worker: missing work-context path')
  }
  if (BRANCH !== 'translation' && BRANCH !== 'deep-reading') {
    fail('sample worker: unsupported branch')
  }
  try {
    const context = JSON.parse(readFileSync(WORK_CONTEXT_PATH, 'utf8'))
    const records = readdirSync(context.sourceRecordsDir)
      .filter((name) => /^p\d+-r\d+\.json$/.test(name))
      .map((name) => JSON.parse(readFileSync(join(context.sourceRecordsDir, name), 'utf8')))
      .sort((left, right) => left.record.order - right.record.order)
    return { ...context, records }
  } catch {
    fail('sample worker: work-context unreadable')
  }
}

function buildSamplePreview(context, branch) {
  const textKinds = new Set(['heading', 'body', 'appendix', 'footnote', 'reference'])
  const sourceRecords = context.records
    .map((entry) => entry.record)
    .filter((record) => record.state === 'present' && textKinds.has(record.kind) && record.text.trim() !== '')
    .slice(0, DISPLAY_LINE_CAP)
  const branchLabel = branch === 'translation' ? '翻译' : '深读'
  const paragraphs = [
    `【样例·${branchLabel}·未完成】本预览仅为示例，由论文原文生成演示段落，不表示${branchLabel === '翻译' ? '译文' : '分析'}已完成或通过质量检查。`,
  ]
  const pieces = []
  for (const record of sourceRecords) {
    const paragraph = `原文示例（未完成）：${record.text.slice(0, MAX_PARAGRAPH_LENGTH - 24)}`
    if (paragraph.length > 0) {
      const contextRecord = [...context.records].reverse().find((candidate) =>
        candidate.record.order < record.order && candidate.record.text === record.context,
      )
      const dependencyRecordIds = new Set([record.id])
      if (record.sectionId !== null) dependencyRecordIds.add(record.sectionId)
      if (contextRecord !== undefined) dependencyRecordIds.add(contextRecord.record.id)
      pieces.push({
        paragraphIndex: paragraphs.length,
        recordId: record.id,
        dependencyRecordIds: [...dependencyRecordIds],
      })
      paragraphs.push(paragraph)
    }
  }
  return { paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS), pieces }
}

const context = parseWorkContext()

emit({ type: 'progress', stage: 'preparing', completed: 0, total: 2 })
emit({ type: 'progress', stage: 'preparing', completed: 1, total: 2 })
emit({ type: 'progress', stage: 'generating', completed: 0, total: 2 })

const preview = buildSamplePreview(context, BRANCH)
emit({ type: 'preview', paragraphs: preview.paragraphs, pieces: preview.pieces })

emit({ type: 'progress', stage: 'generating', completed: 1, total: 2 })
emit({ type: 'progress', stage: 'generating', completed: 2, total: 2 })
