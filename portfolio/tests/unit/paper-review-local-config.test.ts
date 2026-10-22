import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { parseLocalConfig, type PaperReviewLocalConfig } from '../../scripts/paper-review-local/config'

const VALID = [
  'LLM_MODEL_ID=deepseek-r1',
  'LLM_API_KEY=sk-test-key',
  'LLM_BASE_URL=https://api.example.com/v1',
  'PDF_PATH=./papers/demo.pdf',
  '',
].join('\n')

function expectOk(raw: string, cwd: string): PaperReviewLocalConfig {
  const result = parseLocalConfig(raw, cwd)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error('unreachable')
  }
  return result.config
}

describe('paper-review-local config loader', () => {
  it('parses valid env and derives the provider label from the URL host', () => {
    // Given: a valid env file with every required field and an explicit protocol.
    // When: the config is parsed.
    const config = expectOk(
      [
        'LLM_MODEL_ID=deepseek-r1',
        'LLM_API_KEY=sk-test-key',
        'LLM_BASE_URL=https://api.example.com/v1',
        'PDF_PATH=./papers/demo.pdf',
        'LLM_PROTOCOL=anthropic-messages',
        '',
      ].join('\n'),
      resolve('C:/work'),
    )

    // Then: every field is copied and the provider label is the URL host.
    expect(config.modelId).toBe('deepseek-r1')
    expect(config.apiKey).toBe('sk-test-key')
    expect(config.baseUrl).toBe('https://api.example.com/v1')
    expect(config.protocol).toBe('anthropic-messages')
    expect(config.providerLabel).toBe('api.example.com')
  })

  it('defaults the protocol to openai-completions when LLM_PROTOCOL is absent', () => {
    // Given: a valid env file without an LLM_PROTOCOL field.
    // When: the config is parsed.
    const config = expectOk(VALID, 'C:/work')

    // Then: the protocol falls back to the documented default.
    expect(config.protocol).toBe('openai-completions')
  })

  it('strips quotes from quoted env values via parseEnv', () => {
    // Given: env values wrapped in double quotes.
    // When: the config is parsed.
    const config = expectOk(
      [
        'LLM_MODEL_ID="my-model"',
        'LLM_API_KEY="sk-123456"',
        'LLM_BASE_URL="https://host.example/v1"',
        'PDF_PATH="a.pdf"',
        'LLM_PROTOCOL="openai-completions"',
        '',
      ].join('\n'),
      'C:/work',
    )

    // Then: quotes are stripped and the values are used verbatim.
    expect(config.modelId).toBe('my-model')
    expect(config.apiKey).toBe('sk-123456')
    expect(config.baseUrl).toBe('https://host.example/v1')
    expect(config.protocol).toBe('openai-completions')
  })

  it('resolves a relative PDF_PATH against the caller cwd', () => {
    // Given: an env file with a relative PDF path.
    // When: the config is parsed.
    const config = expectOk(VALID, 'C:/work/portfolio')

    // Then: the path is resolved to an absolute path from that cwd.
    expect(config.pdfPath).toBe(resolve('C:/work/portfolio', './papers/demo.pdf'))
  })

  it('reports a missing required field instead of failing silently', () => {
    // Given: an env file missing the API key (and one missing the model id).
    // When: the config is parsed.
    const missingKey = VALID.replace('LLM_API_KEY=sk-test-key', '')
    const missingKeyResult = parseLocalConfig(missingKey, 'C:/work')
    const missingModelResult = parseLocalConfig(VALID.replace('LLM_MODEL_ID=deepseek-r1', ''), 'C:/work')

    // Then: each surfaces a typed failure code (values never echoed).
    expect(missingKeyResult.ok).toBe(false)
    if (!missingKeyResult.ok) {
      expect(missingKeyResult.code).toBe('missing-api-key')
    }
    expect(missingModelResult.ok).toBe(false)
    if (!missingModelResult.ok) {
      expect(missingModelResult.code).toBe('missing-model')
    }
  })

  it('rejects an invalid or credential-smuggling base URL', () => {
    // Given: a non-http URL, a userinfo URL, and a credential query key.
    // When: the config is parsed.
    const ftp = parseLocalConfig(VALID.replace('https://api.example.com/v1', 'ftp://x.example/v1'), 'C:/work')
    const userinfo = parseLocalConfig(VALID.replace('https://api.example.com/v1', 'https://user@x.example/v1'), 'C:/work')
    const queryCred = parseLocalConfig(VALID.replace('https://api.example.com/v1', 'https://x.example/v1?apiKey=sk'), 'C:/work')

    // Then: all three fail closed with the invalid-url code.
    for (const result of [ftp, userinfo, queryCred]) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('invalid-base-url')
      }
    }
  })

  it('rejects an unsupported protocol', () => {
    // Given: an LLM_PROTOCOL outside the supported set.
    // When: the config is parsed.
    const result = parseLocalConfig(`${VALID}\nLLM_PROTOCOL=weird-proto\n`, 'C:/work')

    // Then: it fails closed with the invalid-protocol code.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('invalid-protocol')
    }
  })

  it('never mutates or spreads process.env', () => {
    // Given: the ambient process environment snapshot.
    const before = { ...process.env }

    // When: the config is parsed.
    parseLocalConfig(VALID, 'C:/work')
    parseLocalConfig('LLM_MODEL_ID=x\nLLM_API_KEY=y\nLLM_BASE_URL=https://h/v1\nPDF_PATH=p.pdf\n', 'C:/work')

    // Then: the environment is byte-for-byte unchanged and no LLM_ key leaked.
    expect(process.env).toEqual(before)
    expect(Object.keys(process.env).filter((key) => key.startsWith('LLM_'))).toHaveLength(0)
  })
})