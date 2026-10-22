import { describe, expect, it } from 'vitest'
import { PAPER_TASK_PROVIDER_PROTOCOL_INFO } from '../../app/utils/paper-task-provider-contract'

describe('paper-task provider protocol guidance', () => {
  it('uses the selected protocol’s official API root and request path', () => {
    expect(PAPER_TASK_PROVIDER_PROTOCOL_INFO['openai-completions']).toMatchObject({
      baseUrlPlaceholder: 'https://api.openai.com/v1',
      endpointPath: '/chat/completions',
    })
    expect(PAPER_TASK_PROVIDER_PROTOCOL_INFO['openai-responses']).toMatchObject({
      baseUrlPlaceholder: 'https://api.openai.com/v1',
      endpointPath: '/responses',
    })
    expect(PAPER_TASK_PROVIDER_PROTOCOL_INFO['anthropic-messages']).toMatchObject({
      baseUrlPlaceholder: 'https://api.anthropic.com',
      endpointPath: '/v1/messages',
    })
  })

  it('explains Responses compatibility and when to choose it', () => {
    const responsesGuidance = PAPER_TASK_PROVIDER_PROTOCOL_INFO['openai-responses'].guidance

    expect(responsesGuidance).toContain('Responses API')
    expect(responsesGuidance).toContain('Chat Completions')
  })
})
