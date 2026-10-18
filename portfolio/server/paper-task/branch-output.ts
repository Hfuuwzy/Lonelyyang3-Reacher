import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { RunResult } from '@deepseek-ai/dsh-sdk-client'

/**
 * Verifies that the branch actually published the bytes the runtime read.
 * Deep reading must either echo the exact initial report or carry a completed
 * local-repair receipt for the final bytes; translation must publish natural
 * segments whose retained master and ledger describe the same content.
 */
export function hasSuccessfulBranchWrite(
  result: RunResult,
  markdown: string,
  branch: 'translation' | 'deep-reading',
  branchRoot?: string,
): boolean {
  const writes = result.events.filter((event): event is Extract<RunResult['events'][number], { type: 'tool/call' }> => event.type === 'tool/call'
    && event.data.name === 'paper_task_write_branch')
  return writes.some((call) => {
    const succeeded = result.events.some((event) => event.type === 'tool/result'
      && event.data.message.toolCallId === call.data.callId
      && event.data.message.isError !== true)
    if (!succeeded) return false
    let rawArguments: unknown
    try {
      rawArguments = JSON.parse(call.data.arguments)
    } catch {
      return false
    }
    if (branch === 'translation') {
      return z.object({ segments: z.array(z.unknown()).min(1) }).safeParse(rawArguments).success
    }
    const argumentsResult = z.object({ markdown: z.string().min(1) }).safeParse(rawArguments)
    if (!argumentsResult.success) return false
    if (argumentsResult.data.markdown === markdown) return true
    return branchRoot !== undefined && hasCompletedLocalRepair(branchRoot, markdown)
  })
}

function hasCompletedLocalRepair(branchRoot: string, markdown: string): boolean {
  try {
    const artifact: unknown = JSON.parse(readFileSync(join(branchRoot, 'review.json'), 'utf8'))
    const parsed = z.object({
      repair: z.object({
        repairedSha256: z.string().regex(/^[0-9a-f]{64}$/u),
        error: z.string().optional(),
      }).strict().nullable(),
    }).passthrough().safeParse(artifact)
    return parsed.success
      && parsed.data.repair !== null
      && parsed.data.repair.error === undefined
      && parsed.data.repair.repairedSha256 === createHash('sha256').update(markdown).digest('hex')
  } catch {
    return false
  }
}

export function translationMasterMatches(branchRoot: string, markdown: string): boolean {
  try {
    const metadata: unknown = JSON.parse(readFileSync(join(branchRoot, 'translation.json'), 'utf8'))
    const parsed = z.object({
      masterSha256: z.string().regex(/^[0-9a-f]{64}$/u),
      segments: z.array(z.unknown()).min(1),
    }).passthrough().safeParse(metadata)
    return parsed.success
      && parsed.data.masterSha256 === createHash('sha256').update(markdown).digest('hex')
      && readFileSync(join(branchRoot, 'preview.md'), 'utf8') === markdown
  } catch {
    return false
  }
}
