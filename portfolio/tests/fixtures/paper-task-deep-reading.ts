export const DEEP_RESOURCES = [
  'SKILL.md', 'references/5w2h_analysis.md', 'references/comparison_matrix.md', 'references/critical_thinking.md',
  'references/first_principles.md', 'references/inversion_thinking.md', 'references/mental_models.md',
  'references/output_templates.md', 'references/scqa_framework.md', 'references/six_hats.md', 'references/systems_thinking.md',
] as const
export const TRANSLATION_RESOURCES = [
  'SKILL.md', 'references/translation_rules.md', 'references/markdown_rules.md', 'references/dependencies.md',
  'references/qa_checklist.md', 'references/vendor_notes.md', 'vendor/pdfs/SKILL.md', 'vendor/docx/SKILL.md',
] as const
export const SOURCE_TEXT = [
  '本文研究的问题是：短期的校园干预能否改善偏远地区学生的长期学习成果？',
  '研究方法：研究团队将十二所学校随机分配至干预组与对照组，并在两个学年内追踪出勤和标准化测验。',
  '主要结果：第一学年干预组的平均测验分数提高了八个百分点。',
  '较晚的结果显示：第二学年差异缩小至零，且置信区间同时包含正向与负向效果。',
  '作者指出，样本仅来自十二所学校，且第二年有较多学生失访。',
  '因此，现有证据不足以断言效果可推广至其他地区；应用时应先开展长期追踪和当地试点。',
] as const
const FACT = '事实：第一学年干预组平均测验分数提高八个百分点。'
const METHOD_INFERENCE = '分析推论：随机分配增强了组间比较的解释力，但并不自动证明作用机制。'
const LATE_INFERENCE = '分析推论：结合第一年的改善与第二年的零差异，持久收益尚未成立，不能用短期改善替代长期证据。'
export const REPORT = [
  '# 这项校园干预能否带来持久改变？',
  '论文的问题是短期支持能否改善偏远地区学生的长期学习成果，而非一次测验是否上升。',
  '论文报告：研究团队把十二所学校随机分入两组，持续两个学年记录出勤和标准化测验。',
  `${FACT}这一观察不等同于长期收益。`,
  METHOD_INFERENCE,
  '论文报告：后段的第二学年差异缩小至零，置信区间同时包含正向与负向效果。',
  LATE_INFERENCE,
  '论文指出：样本只来自十二所学校，第二年失访较多，后期估计应结合样本构成理解。',
  '应用推论：推广前应在目标地区先做小规模试点，预先规划长期追踪和失访分析。',
  '需确认：第二学年的失访机制尚未核实，不能断言其与学生表现无关。',
].join('\n\n')
export const CLAIMS = [
  { passage: FACT, kind: 'fact', source_record_id: 'p1-r2', quote: SOURCE_TEXT[2] },
  { passage: METHOD_INFERENCE, kind: 'inference', source_record_id: 'p1-r1', quote: SOURCE_TEXT[1], explanation: '这是对随机分配设计的解释，不是对因果机制的观测。' },
  { passage: LATE_INFERENCE, kind: 'inference', source_record_id: 'p2-r3', quote: SOURCE_TEXT[3], explanation: '将原文早期改善与较晚的零差异相联系，限定长期效果结论。' },
] as const
