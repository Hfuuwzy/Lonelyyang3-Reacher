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

import { readFileSync } from 'node:fs'

const WORK_CONTEXT_PATH = process.argv[2]
const BRANCH = process.argv[3]

const MAX_PARAGRAPHS = 8
const MAX_PARAGRAPH_LENGTH = 2000
const EXCERPT_LINE_CAP = 6

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
    return JSON.parse(readFileSync(WORK_CONTEXT_PATH, 'utf8'))
  } catch {
    fail('sample worker: work-context unreadable')
  }
}

function buildSampleParagraphs(context, branch) {
  const sourceLines = String(context.sourceExcerpt ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, EXCERPT_LINE_CAP)

  const branchLabel = branch === 'translation' ? '翻译' : '深读'
  const paragraphs = [
    `【样例·${branchLabel}·未完成】本预览仅为示例，由论文原文生成演示段落，不表示${branchLabel === '翻译' ? '译文' : '分析'}已完成或通过质量检查。`,
  ]
  for (const line of sourceLines) {
    const paragraph = `原文示例（未完成）：${line.slice(0, MAX_PARAGRAPH_LENGTH - 24)}`
    if (paragraph.length > 0) {
      paragraphs.push(paragraph)
    }
  }
  return paragraphs.slice(0, MAX_PARAGRAPHS)
}

const context = parseWorkContext()

emit({ type: 'progress', stage: 'preparing', completed: 0, total: 2 })
emit({ type: 'progress', stage: 'preparing', completed: 1, total: 2 })
emit({ type: 'progress', stage: 'generating', completed: 0, total: 2 })

const paragraphs = buildSampleParagraphs(context, BRANCH)
emit({ type: 'preview', paragraphs })

emit({ type: 'progress', stage: 'generating', completed: 1, total: 2 })
emit({ type: 'progress', stage: 'generating', completed: 2, total: 2 })
