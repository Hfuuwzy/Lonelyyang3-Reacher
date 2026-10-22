import { describe, expect, it } from 'vitest'
import { clean, diagnoseEvents, safeDiagnosticEvent } from '../../server/paper-task/dsh-outcome'

describe('DSH runtime diagnostic redaction', () => {
  it('removes the configured key and credential-shaped values before persistence', () => {
    const key = 'fixture-secret-value'
    const raw = `failure ${key}; Authorization: Bearer ${key}; api_key=${key}; x-api-key: ${key}`

    const sanitized = clean(raw, key)

    expect(sanitized).not.toContain(key)
    expect(sanitized).not.toContain('Bearer fixture-secret-value')
    expect(sanitized).not.toContain('api_key=fixture-secret-value')
    expect(sanitized).not.toContain('x-api-key: fixture-secret-value')
  })

  it('keeps only bounded tool identity and result facts from rejected-run notifications', () => {
    const safeEvent = safeDiagnosticEvent({
      type: 'tool/call',
      data: { callId: 'call-1', name: 'paper_task_write_branch', arguments: 'source text', payload: 'data:image/png;base64,QUJD' },
    }, '')

    expect(JSON.stringify(safeEvent)).toBe('{"type":"tool/call","data":{"callId":"call-1","name":"paper_task_write_branch"}}')
  })

  it('retains failed tool error text when the SDK supplies no structured error field', () => {
    const events = [
      { type: 'tool/call', data: { callId: 'repair-1', name: 'paper_task_apply_local_repair' } },
      { type: 'tool/result', data: { message: { toolCallId: 'repair-1', isError: true, content: [
        { type: 'text', text: 'Error: repair target is outside the reviewed paragraphs; Bearer fixture-secret' },
      ] } } },
    ]

    const diagnostics = diagnoseEvents(events, 'primary', 'fixture-secret')
    const observed = safeDiagnosticEvent(events[1], 'fixture-secret')

    expect(diagnostics.failedTools[0]?.message).toContain('outside the reviewed paragraphs')
    expect(JSON.stringify(observed)).toContain('outside the reviewed paragraphs')
    expect(JSON.stringify(diagnostics)).not.toContain('fixture-secret')
    expect(JSON.stringify(observed)).not.toContain('fixture-secret')
  })
})
