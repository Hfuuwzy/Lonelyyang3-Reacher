import type { PaperTaskBranch, PaperTaskDesignation } from './paper-task-contract'

export interface PaperTaskQualityEntry {
  readonly branch: PaperTaskBranch
  readonly branchLabel: string
  readonly headingLabel: string
  readonly badge: string
  readonly designation: PaperTaskDesignation
  readonly statusLabel?: string
  readonly issues: readonly string[]
  readonly options: readonly string[]
}

export type PaperTaskQualityIssueCategory = 'table' | 'formula' | 'source' | 'capability' | 'other'

export interface PaperTaskQualityIssue {
  readonly category: PaperTaskQualityIssueCategory
  readonly text: string
  readonly branchLabels: readonly string[]
}

export interface PaperTaskQualityIssueGroup {
  readonly category: PaperTaskQualityIssueCategory
  readonly label: string
  readonly issues: readonly PaperTaskQualityIssue[]
}

export interface PaperTaskQualityHandlingOption {
  readonly label: string
  readonly branchLabels: readonly string[]
}

export interface PaperTaskQualityReport {
  readonly groups: readonly PaperTaskQualityIssueGroup[]
  readonly issueCount: number
  readonly capabilityCount: number
  readonly unclassifiedCount: number
  readonly handlingOptions: readonly PaperTaskQualityHandlingOption[]
}

const CATEGORY_ORDER: readonly PaperTaskQualityIssueCategory[] = [
  'table',
  'formula',
  'source',
  'capability',
  'other',
]

const CATEGORY_LABELS: Record<PaperTaskQualityIssueCategory, string> = {
  table: '表格／数值',
  formula: '公式',
  source: '原文／图像',
  capability: '工具／格式能力',
  other: '其他未分类需确认事项',
}

const QUALITY_OPTION_LABELS: Record<string, string> = {
  'keep-readable': '保留当前可读内容',
  'inspect-source': '核对原文材料',
  regenerate: '重新生成',
}

/** Only Unicode canonical form and whitespace are normalized; wording stays exact. */
function normalizeExactText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

function classifyIssue(issue: string): PaperTaskQualityIssueCategory {
  const text = issue.normalize('NFKC').toLocaleLowerCase('en-US')
  const namesToolOrFormat = /(?:\bpdf\b|\bdocx?\b|\bword\b|pandoc|导出|格式|文档|文件|\bexport\b|\bconvert\b)/iu.test(text)
  const explicitlyStatesLimitation = /(?:unsupported|not\s+supported|not\s+available|unavailable|not\s+provided|not\s+in\s+scope|cannot|can't|不支持|不提供|未提供|未实现|无法|不能|暂不|未生成|未就绪|未开启|未启用|仅声明)/iu.test(text)
  // An export limitation may mention tables without reporting a content error.
  // Mixed warnings stay critical rather than hiding a numerical/source defect.
  if (namesToolOrFormat && explicitlyStatesLimitation
    && /(?:导出|格式转换|打包|\bexport\b|\bconvert\b)/iu.test(text)
    && paperTaskQualityIssuePriority(text) === 0
    && !/(?:公式|方程|图像|图片|图注|引文|引用|核对|核实|验证|\bformula\b|\bequation\b|\bimage\b|\bfigure\b|\bcitation\b|\bverif)/iu.test(text)) {
    return 'capability'
  }

  if (/(?:表格|表\s*\d|\btable\b|table\d+|\bcols?\b|\bcolumns?\b|\brows?\b|f1|\bprecision\b|\brecall\b|数值|数字|缺失值|missing\s+values|短横线|虚线)/iu.test(text)) {
    return 'table'
  }
  if (/(?:公式|方程|\bequation\b|\bformula\b|\blatex\b|\bmath(?:ematical)?\b)/iu.test(text)) {
    return 'formula'
  }
  if (/(?:原文|原始材料|来源|\bsource\b|图像|图片|\bimage\b|\bfigure\b|引文|引用|\bcitation\b)/iu.test(text)) {
    return 'source'
  }

  if (namesToolOrFormat && explicitlyStatesLimitation) {
    return 'capability'
  }
  return 'other'
}

/** Prioritize concrete material errors over broad verification reminders. */
export function paperTaskQualityIssuePriority(issue: string): number {
  const text = issue.normalize('NFKC').toLocaleLowerCase('en-US')
  let priority = 0

  if (/(?:错误|失真|失配|错位|不符|不匹配|不正确|有误|偏差|\bwrong\b|\bincorrect\b|\berror\b|\bdistort(?:ed|ion)?\b|\binvent(?:ed|ion)?\b|\bfabricat(?:ed|ion)?\b)/iu.test(text)) priority += 5
  if (/(?:重复|\bduplicat(?:e|ed|ion)?\b|\bsame\b.{0,24}\b(?:value|number|score|metric)\b|同一.{0,16}(?:重复|数值|指标))/iu.test(text)) priority += 4
  if (/(?:\d+\s*列|列结构|列数|\bcolumns?\b|\bcols?\b|row\s+count|mismatch|不一致|结构差异|\bclipped\b|裁掉|裁切|截断|遮挡)/iu.test(text)) priority += 3
  if (/(?:缺失值|遗漏|缺少|填入|补入|新增|\bomitted\b|\binserted\b|missing\s+data)/iu.test(text)) priority += 2

  return priority
}

export function paperTaskQualityOptionLabel(option: string): string {
  return QUALITY_OPTION_LABELS[option] ?? option
}

/**
 * Deduplicates only canonically equivalent text with the same whitespace. It
 * retains the first exact wording and associates every affected branch.
 */
export function buildPaperTaskQualityReport(
  entries: readonly PaperTaskQualityEntry[],
): PaperTaskQualityReport {
  const issuesByText = new Map<string, {
    category: PaperTaskQualityIssueCategory
    text: string
    branches: Map<PaperTaskBranch, string>
  }>()
  const optionsByText = new Map<string, {
    label: string
    branches: Map<PaperTaskBranch, string>
  }>()

  for (const entry of entries) {
    for (const issue of entry.issues) {
      const normalized = normalizeExactText(issue)
      const key = normalized === '' ? issue : normalized
      const current = issuesByText.get(key)
      if (current === undefined) {
        issuesByText.set(key, {
          category: classifyIssue(issue),
          text: issue,
          branches: new Map([[entry.branch, entry.branchLabel]]),
        })
      } else if (!current.branches.has(entry.branch)) {
        current.branches.set(entry.branch, entry.branchLabel)
      }
    }

    for (const option of entry.options) {
      const label = paperTaskQualityOptionLabel(option)
      const normalized = normalizeExactText(label)
      const key = normalized === '' ? label : normalized
      const current = optionsByText.get(key)
      if (current === undefined) {
        optionsByText.set(key, {
          label,
          branches: new Map([[entry.branch, entry.branchLabel]]),
        })
      } else if (!current.branches.has(entry.branch)) {
        current.branches.set(entry.branch, entry.branchLabel)
      }
    }
  }

  const issues = [...issuesByText.values()].map((issue) => ({
    category: issue.category,
    text: issue.text,
    branchLabels: [...issue.branches.values()],
  }))
  const groups = CATEGORY_ORDER.flatMap((category) => {
    const groupedIssues = issues.filter((issue) => issue.category === category)
    return groupedIssues.length === 0
      ? []
      : [{ category, label: CATEGORY_LABELS[category], issues: groupedIssues }]
  })

  return {
    groups,
    issueCount: issues.length,
    capabilityCount: issues.filter((issue) => issue.category === 'capability').length,
    unclassifiedCount: issues.filter((issue) => issue.category === 'other').length,
    handlingOptions: [...optionsByText.values()].map((option) => ({
      label: option.label,
      branchLabels: [...option.branches.values()],
    })),
  }
}
