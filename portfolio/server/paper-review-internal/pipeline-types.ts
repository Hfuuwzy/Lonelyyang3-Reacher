/**
 * Dependency / lifecycle type declarations for the paper-review event pipeline
 * (issues #27/#29).
 *
 * Lives outside `server/utils` so Nuxt's auto-import scanner never treats these
 * declarations as composables. The file is type-only, so the facade can import
 * it across module boundaries without introducing a runtime cycle; the facade
 * re-exports both interfaces from its own path so public callers (the route
 * handler and the local runner) keep their imports stable.
 */

import type {
  PaperReviewTaskGap,
  PaperSourceInventory,
  PaperSourceReview,
  PaperSourceUnit,
  PaperTranslationPair,
} from '../../app/utils/paper-review-task-contract'
import type {
  ExtractedPaperPage,
  PaperExtractionResult,
} from '../utils/paper-review/pdf'
import type {
  PaperReviewHarnessResult,
  PaperReviewModelRequest,
  PaperReviewRunnerDependencies,
  PaperReviewRunInput,
  PaperReviewRunOptions,
} from '../utils/paper-review/harness'
import type { PaperReviewReportResult } from '../utils/paper-review/report'
import type { FrozenPaperTranslation } from '../utils/paper-review/source-review'

export interface PaperReviewPipelineDependencies {
  readonly extractPaperPages?: (bytes: Uint8Array, signal?: AbortSignal) => Promise<PaperExtractionResult>
  readonly runPaperReview?: (
    input: PaperReviewRunInput,
    request: PaperReviewModelRequest,
    deps?: PaperReviewRunnerDependencies,
    options?: PaperReviewRunOptions,
  ) => Promise<PaperReviewHarnessResult>
  readonly validateInventoryBatch?: (pages: readonly ExtractedPaperPage[], candidateIds: readonly string[], raw: string) => {
    readonly units: readonly PaperSourceUnit[]
    readonly gaps: readonly PaperReviewTaskGap[]
  }
  readonly verifyPaperReview?: (
    raw: string,
    pages: readonly ExtractedPaperPage[],
    provider: string,
    model: string,
  ) => PaperReviewReportResult
  readonly validateTranslationBatch?: (source: PaperSourceInventory, batchIds: readonly string[], raw: string) => {
    readonly pairs: readonly PaperTranslationPair[]
    readonly gaps: readonly PaperReviewTaskGap[]
  }
  readonly freezePaperTranslation?: (
    source: PaperSourceInventory,
    pairs: readonly PaperTranslationPair[],
  ) => FrozenPaperTranslation
  readonly validateSourceReviewBatch?: (frozen: FrozenPaperTranslation, batchIds: readonly string[], raw: string) => {
    readonly review: PaperSourceReview
    readonly gaps: readonly PaperReviewTaskGap[]
  }
}

/** Per-invocation lifecycle knobs, e.g. a disconnect/cancel signal. */
export interface PaperReviewLifecycleOptions {
  readonly signal?: AbortSignal
}