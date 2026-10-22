/**
 * Captured selected actual text items from the public CodeBERT paper
 * (arXiv 2002.08155), reader pages 5, 7 and 10, re-typed from a real extraction.
 * Retained so maintained tests can exercise candidate/inventory/scope logic on
 * genuine two-column, table, code and appendix content without any network
 * access or paid model calls. The geometry (column / baselineY / heading) is
 * preserved so prose grouping and region awareness still apply.
 */
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'

export interface CapturedCodebertLine {
  readonly text: string
  readonly heading?: boolean
  readonly column?: number
  readonly baselineY?: number
  readonly ambiguous?: boolean
  readonly recognized?: 'table'
}

/** Page 5: two-column prose with column-local numbered headings and math displays. */
export const codebertPage5Lines: readonly CapturedCodebertLine[] = [
  { text: 'an indicator function and p is the discriminator', column: 0, baselineY: 768 },
  { text: 'that predicts the probability of the i-th word being', column: 0, baselineY: 755 },
  { text: '| w | +| c|', column: 0, baselineY: 720 },
  { text: '( )( )', column: 0, baselineY: 683 },
  { text: '1, if x = x .', column: 0, baselineY: 622 },
  { text: '0, otherwise.', column: 0, baselineY: 606 },
  { text: 'There are many different ways to implement the', column: 0, baselineY: 586 },
  { text: 'generators. In this work, we implement two ef-', column: 0, baselineY: 572 },
  { text: 'Focusing each paragraph in its own column avoids mixed prose.', column: 0, baselineY: 464 },
  { text: '3.5 Fine-Tuning CodeBERT', heading: true, column: 0, baselineY: 344 },
  { text: 'We have different settings to use CodeBERT in', column: 0, baselineY: 327 },
  { text: 'downstream NL-PL tasks. For example, in natural', column: 0, baselineY: 313 },
  { text: '4 Experiment', heading: true, column: 0, baselineY: 181 },
  { text: 'We present empirical results in this section to verify', column: 0, baselineY: 160 },
  { text: 'the effectiveness of CodeBERT. We first describe', column: 0, baselineY: 147 },
  { text: 'of CodeBERT are fixed. Finally, we evaluate Code-', column: 1, baselineY: 768 },
  { text: 'BERT on a generation problem, i.e. code documen-', column: 1, baselineY: 755 },
  { text: '4.1 Natural Language Code Search', heading: true, column: 1, baselineY: 689 },
  { text: 'Given a natural language as the input, the objec-', column: 1, baselineY: 670 },
  { text: 'with randomly replaced NL (i.e. (c , w)) and PL', column: 1, baselineY: 399, ambiguous: true },
  { text: '5', column: 1, baselineY: 498 },
]

/** Page 7: a full-width table (recognized) plus two-column prose and code rows. */
export const codebertPage7Lines: readonly CapturedCodebertLine[] = [
  { text: 'RUBY', column: 0, baselineY: 768 },
  { text: 'PL (2 CHOICES ) 38', column: 0, baselineY: 743 },
  { text: 'R OBERTA 73.68 63.97 72.37 59.18 59.96 69.78 62.45', baselineY: 710, recognized: 'table' },
  { text: 'C ODE BERT (MLM) 86.84 86.40 90.79 82.20 90.46 88.21 85.66', baselineY: 690, recognized: 'table' },
  { text: 'Table 3: Statistics of the data for NL-PL probing and the performance of different pre-trained models. Accuracies', baselineY: 583 },
  { text: '(% ) are reported. Best results in each group are in bold.', column: 0, baselineY: 571 },
  { text: 'datasets in different programming languages are', column: 0, baselineY: 537 },
  { text: 'extremely unbalanced, we report the accumulated', column: 0, baselineY: 523 },
  { text: '(MLM) here because its output layer naturally fits', column: 0, baselineY: 496 },
  { text: 'on both NL and PL probing. The numbers with', column: 0, baselineY: 455 },
  { text: 'work.', column: 0, baselineY: 401 },
  { text: '4.3 Code Documentation Generation', heading: true, column: 0, baselineY: 283 },
  { text: 'Although the pre-training objective of Code-', column: 0, baselineY: 264 },
  { text: 'generation task on CodeSearchNet Corpus in', column: 0, baselineY: 183 },
  { text: '7', column: 0, baselineY: 337 },
  { text: 'def vec_to_halfvec(vec):', column: 1, baselineY: 500 },
  { text: 'd = vec[ 1:] - vec[:- 1]', column: 1, baselineY: 482 },
  { text: 'return np. arange(lowest, highest + 0.1*dx, dx). astype(vec.dtype)', column: 1, baselineY: 420 },
  { text: 'Figure 3: Case study on python language. Masked to-', column: 1, baselineY: 330 },
]

/** Page 10: references tail, then Appendix A (left) before Appendix B (right). */
export const codebertPage10Lines: readonly CapturedCodebertLine[] = [
  { text: 'References', baselineY: 900 },
  { text: 'Alec Radford, Karthik Narasimhan, Tim Salimans,', column: 0, baselineY: 768 },
  { text: 'and Ilya Sutskever. 2018. Improving language', column: 0, baselineY: 757 },
  { text: 'understanding by generative pre-training. URL', column: 0, baselineY: 746 },
  { text: 'C ODE S EARCH T RAINING D EV T ESTING', column: 1, baselineY: 768 },
  { text: 'G O 635,635 28,483 14,291', column: 1, baselineY: 753, recognized: 'table' },
  { text: 'Assets for references keep flowing in the left column.', column: 0, baselineY: 691 },
  { text: 'Lee, Sharan Narang, Michael Matena, Yanqi Zhou,', column: 0, baselineY: 680 },
  { text: 'former. arXiv preprint arXiv:1910.10683 .', column: 0, baselineY: 648 },
  { text: 'A Data Statistic', column: 0, baselineY: 128 },
  { text: 'Data statistics of the training/validation/testing data', column: 0, baselineY: 106 },
  { text: 'splits for six programming languages are given in', column: 0, baselineY: 92 },
  { text: 'Table 6.', column: 0, baselineY: 79 },
  { text: 'PHP 1,047,406 52,029 28,391', column: 1, baselineY: 723, recognized: 'table' },
  { text: 'B Train Details', column: 1, baselineY: 633 },
  { text: 'B.1 Pre-training', column: 1, baselineY: 610 },
  { text: 'We train CodeBERT on one NVIDIA DGX-2 ma-', column: 1, baselineY: 591 },
  { text: 'chine using FP16. It combines 16 interconnected', column: 1, baselineY: 578 },
  { text: 'B.2 CodeSearch', column: 1, baselineY: 444 },
  { text: 'B.4 Code Summarization on C#', column: 1, baselineY: 166 },
]

export function codebertCapturedPage(pageNumber: number): ExtractedPaperPage {
  const data: Record<number, { readonly lines: readonly CapturedCodebertLine[] }> = {
    5: { lines: codebertPage5Lines },
    7: { lines: codebertPage7Lines },
    10: { lines: codebertPage10Lines },
  }
  const entry = data[pageNumber]
  if (entry === undefined) {
    throw new Error(`No captured CodeBERT page ${pageNumber}`)
  }
  return {
    readerPage: pageNumber,
    pageWidth: 595.276,
    pageHeight: 841.89,
    lines: entry.lines.map((line) => ({
      text: line.text,
      isHeading: line.heading === true,
      ...(line.column === undefined ? {} : { column: line.column }),
      ...(line.baselineY === undefined ? {} : { baselineY: line.baselineY }),
      ...(line.ambiguous === undefined ? {} : { ambiguous: line.ambiguous }),
      ...(line.recognized === undefined ? {} : { recognized: line.recognized }),
    })),
    headings: entry.lines.filter((line) => line.heading === true).map((line) => line.text),
    text: entry.lines.map((line) => line.text).join('\n'),
  }
}