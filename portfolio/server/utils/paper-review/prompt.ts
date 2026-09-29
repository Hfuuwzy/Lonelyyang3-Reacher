import type { ExtractedPaperPage } from './pdf'

/**
 * Pure prompt construction for the paper-review harness run (issue #27).
 *
 * The prompt is built only from page-labelled text, candidate headings, and
 * the caller's provider/model labels — never from the API key, which stays in
 * the child environment. The model is asked to return a single JSON object
 * matching the shared `PaperReviewReport` wire contract, and to record gaps
 * instead of inventing unsupported claims.
 */

/** Minimal source data the prompt needs; the API key is deliberately absent. */
export interface PaperReviewPromptSource {
  readonly providerLabel: string
  readonly model: string
  readonly pages: readonly ExtractedPaperPage[]
}

/** One page block rendered from an extracted page. */
function renderPage(page: ExtractedPaperPage): string {
  const headings = page.headings.length > 0 ? page.headings.join('; ') : '(none)'
  return [`## Page ${page.readerPage}`, `HEADINGS: ${headings}`, page.text].join('\n')
}

/** The JSON object shape the model must produce, one physical line per rule. */
const JSON_CONTRACT = [
  '{',
  '  "status": "incomplete",',
  '  "provider": "<provider label>",',
  '  "model": "<model id>",',
  '  "sections": [',
  '    {',
  '      "kind": "claims" | "methods" | "experiments" | "evidence" | "criticism",',
  '      "title": "<section heading label>",',
  '      "findings": [',
  '        {',
  '          "statement": "<one claim or observation grounded in the page text>",',
  '          "source": {',
  '            "heading": "<nearest candidate heading above the quote, or empty>",',
  '            "readerPage": 1,',
  '            "quote": "<short verbatim substring of that page>",',
  '            "printedPage": "optional printed page number, omit if unknown"',
  '          }',
  '        }',
  '      ]',
  '    }',
  '  ],',
  '  "gaps": [',
  '    { "section": "<section label or overall>", "reason": "<why the text cannot support it>" }',
  '  ],',
  '  "missingScope": ["full-translation"]',
  '}',
  '',
  'Rules:',
  '- "kind" must be one of: claims, methods, experiments, evidence, criticism.',
  '- "source.readerPage" is the 1-based page the quote appears on.',
  '- "source.heading" is the closest candidate heading above the quote, or empty.',
  '- "source.quote" must be a verbatim substring of the provided page text.',
  '- Populate "gaps" for any claim the text does not support or any section you cannot evidence.',
  '- Never invent, assume, or extrapolate claims absent from the provided text.',
].join('\n')

/**
 * Build the review prompt from page-labelled text and candidate headings.
 * @param source - provider/model labels and the extracted pages.
 * @returns the prompt to send as the single harness run input.
 */
export function buildPaperReviewPrompt(source: PaperReviewPromptSource): string {
  const pageBlocks = source.pages.map(renderPage)
  const contract = JSON_CONTRACT.replace('<provider label>', source.providerLabel)
    .replace('<model id>', source.model)
  return [
    'You are a rigorous research paper reviewer. Return only a single JSON object — no prose and no markdown fences — matching exactly this schema:',
    contract,
    '',
    'Provided paper text, one block per reader page. Each page lists its candidate headings on the line after "HEADINGS:".',
    ...pageBlocks,
    '',
    `Now return the JSON object with "provider" = "${source.providerLabel}" and "model" = "${source.model}".`,
  ].join('\n')
}
