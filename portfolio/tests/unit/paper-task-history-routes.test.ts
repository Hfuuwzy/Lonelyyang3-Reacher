import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const historyRoute = readFileSync(new URL('../../server/api/prototype/paper-task.get.ts', import.meta.url), 'utf8')
const eventsRoute = readFileSync(new URL('../../server/api/prototype/paper-task/[id]/events.get.ts', import.meta.url), 'utf8')

describe('paper-task history routes', () => {
  it('keeps the process-local history endpoint behind the existing loopback and dev-peer gate', () => {
    expect(historyRoute).toContain('import.meta.dev')
    expect(historyRoute).toContain('consumeAttestedDevPeer')
    expect(historyRoute).toContain('checkPaperReviewAccess')
    expect(historyRoute).toContain('paperTaskService().history()')
    expect(historyRoute).toContain("'cache-control': 'no-store'")
  })

  it('replays only an existing task and applies the same guarded local task access', () => {
    expect(eventsRoute).toContain('requirePaperTaskSourceAccess(event, import.meta.dev)')
    expect(eventsRoute).toContain('paperTaskService().events(taskId)')
    expect(eventsRoute).toContain('renderPaperTaskSse(events)')
    expect(eventsRoute).not.toContain('.submit(')
    expect(eventsRoute).not.toContain('.cancel(')
  })
})
