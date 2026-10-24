// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PaperTaskQualityPanel from '../../app/components/agents/PaperTaskQualityPanel.vue'

const tableIssue = '原文表 4 有 3 列，生成稿有 4 列；0.943 同时被标作 total F1 与 fake F1；原文缺失值被填入短横线。'
const nearDuplicateTableIssue = '原文表 4 有 3 列，生成稿有 4 列；0.943 同时被标作 total-F1 与 fake F1；原文缺失值被填入短横线。'

const entries = [
  {
    branch: 'translation',
    branchLabel: '翻译',
    headingLabel: '译文预览',
    badge: '需确认 · 保留可读内容',
    designation: 'generated-preview',
    issues: [
      tableIssue,
      `  ${tableIssue}  `,
      '公式中的 β 符号需要与原文再次核对。',
      '图像与图注位置仍需同原文核对。',
      '当前不提供 PDF、DOCX 或 Pandoc 文件转换。',
      '正文里多了一句未经说明的评价性判断。',
    ],
    options: ['核对原文材料', '保留当前可读内容'],
  },
  {
    branch: 'deep-reading',
    branchLabel: '深读',
    headingLabel: '深读预览',
    badge: 'SAMPLE',
    designation: 'sample',
    issues: [tableIssue, nearDuplicateTableIssue],
    options: ['检查引用证据'],
  },
] as const

describe('paper task quality panel', () => {
  it('prioritizes numerical mismatches over reminders without elevating pure format export limits', () => {
    const wrapper = mount(PaperTaskQualityPanel, { props: { entries: [{
      ...entries[0], issues: ['表格仍需复核。', '数值与原文不符。', 'PDF 表格导出暂不支持'],
    }] } })
    const critical = wrapper.get('[data-testid="paper-task-quality-critical"]')
    expect(critical.text()).toContain('数值与原文不符。')
    expect(critical.text()).not.toContain('PDF 表格导出暂不支持')
    expect(wrapper.get('.paper-task-quality__capability-summary').text()).toContain('1 项')
    expect(wrapper.get('[data-testid="paper-task-quality-details"]').text()).toContain('PDF 表格导出暂不支持')
    wrapper.unmount()
  })

  it('shows the branch qualification once when its labels repeat the badge', () => {
    const wrapper = mount(PaperTaskQualityPanel, { props: { entries: [{
      ...entries[0], headingLabel: '需确认', statusLabel: '需确认',
    }] } })
    expect(wrapper.get('.paper-task-quality__branches').text().match(/需确认/gu)).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps critical source-table evidence prominent and summarizes capability and unclassified counts', () => {
    const wrapper = mount(PaperTaskQualityPanel, { props: { entries } })
    const panel = wrapper.get('[data-testid="paper-task-quality-panel"]')
    const criticalIssue = panel.get('[data-testid="paper-task-quality-critical"]')

    expect(wrapper.findAll('[data-testid="paper-task-quality-panel"]')).toHaveLength(1)
    expect(panel.text()).toContain('翻译')
    expect(panel.text()).toContain('SAMPLE')
    expect(panel.text()).toContain('需确认 · 保留可读内容')
    expect(criticalIssue.text()).toContain('表格／数值需核对')
    expect(criticalIssue.text()).toContain(tableIssue)
    expect(criticalIssue.text()).toContain('公式需核对')
    expect(criticalIssue.text()).toContain('公式中的 β 符号需要与原文再次核对。')
    expect(criticalIssue.text()).toContain('原文／图像需核对')
    expect(criticalIssue.text()).toContain('图像与图注位置仍需同原文核对。')
    expect(criticalIssue.text()).toContain('翻译、深读')
    expect(criticalIssue.element.closest('details')).toBeNull()
    expect(panel.text()).toContain('工具／格式能力限制：1 项')
    expect(panel.text()).toContain('未分类需确认事项：1 项')
    expect(panel.text()).not.toContain('质量检查通过')

    wrapper.unmount()
  })

  it('expands all grouped issue text and handling choices without fuzzy-merging distinct issues', async () => {
    const wrapper = mount(PaperTaskQualityPanel, { props: { entries } })
    const disclosure = wrapper.get('[data-testid="paper-task-quality-details"]')

    expect((disclosure.element as HTMLDetailsElement).open).toBe(false)
    await disclosure.get('summary').trigger('click')
    expect((disclosure.element as HTMLDetailsElement).open).toBe(true)

    const expandedText = disclosure.text()
    expect(expandedText).toContain('表格／数值')
    expect(expandedText).toContain('公式')
    expect(expandedText).toContain('原文／图像')
    expect(expandedText).toContain('工具／格式能力')
    expect(expandedText).toContain('其他未分类需确认事项')
    expect(expandedText).toContain(tableIssue)
    expect(expandedText).toContain(nearDuplicateTableIssue)
    expect(expandedText).toContain('当前不提供 PDF、DOCX 或 Pandoc 文件转换。')
    expect(expandedText).toContain('正文里多了一句未经说明的评价性判断。')
    expect(expandedText).toContain('核对原文材料')
    expect(expandedText).toContain('检查引用证据')
    expect(disclosure.findAll('li').filter(item => item.text().includes(tableIssue))).toHaveLength(1)

    wrapper.unmount()
  })

  it('keeps critical summaries compact, ranks material table errors first, and expands every original issue', async () => {
    const materialTableIssue = '原文表 4 的列结构为 3 列，生成稿却输出 4 列；同一 0.943 被重复标作 total F1 与 fake F1，原文中缺失的数值又被错误地填成短横线。请根据原文表格逐项核对，不能把列、指标含义和缺失值当作格式差异处理。'
    const tableIssues = [
      '表格摘要仍需参照原文进一步核查，尚未形成具体差异说明；请同时检查指标定义、各列标题、单位和脚注之间的对应关系，并确认这些信息没有在生成文本中被合并或省略。',
      '表格页脚的文字位置需要人工复核；当前稿件没有说明页脚数值适用的行范围，也没有交代其与表头单位的关系，请逐项回到原文表格确认而不要根据相邻段落推断。',
      materialTableIssue,
    ]
    const formulaIssues = [
      '公式符号的渲染形式需要复核；请逐项确认变量名称、上下标、求和范围和标点没有在转换过程中被替换，尤其不要把相邻公式视为同一个表达式。',
      '公式中的上标位置需与论文原文校对；目前无法从预览判断上标属于变量、指数还是引用标记，请打开对应原文位置核实而不要根据语境补全。',
      '公式上下文可能缺少一项条件，需核对完整推导；现有文本没有说明该条件来自正文、公式编号还是脚注，因此不能仅凭当前显示判断公式是否成立。',
    ]
    const unverifiedImageIssue = '图像输入能力仅为提供方声明；图像和图注的对应关系尚未验证，请逐一比对原文页面上的图号、图注顺序、裁切边界与正文引用，不要把提供方声明当成已完成图像核验。'
    const sourceIssues = [
      unverifiedImageIssue,
      '图像边界可能裁掉了原文中的标注，请逐图检查；尤其需确认坐标轴、图例和边缘注释均完整，并且当前预览没有将相邻图块拼在一起。',
      '图表的原文页码和当前图片仍需人工比对；现有元数据不能证明截图来自同一页或同一图号，相关证据应保留在完整问题列表中供逐条检查。',
    ]
    const allIssues = [...tableIssues, ...formulaIssues, ...sourceIssues, '当前不提供 PDF、DOCX 或 Pandoc 文件转换。']
    const longIssueEntries = [{
      branch: 'translation',
      branchLabel: '翻译',
      headingLabel: '译文预览',
      badge: '需确认',
      designation: 'generated-preview',
      issues: allIssues,
      options: [],
    }] as const
    const wrapper = mount(PaperTaskQualityPanel, { props: { entries: longIssueEntries } })
    const critical = wrapper.get('[data-testid="paper-task-quality-critical"]')
    const tableGroup = critical.get('[data-category="table"]')
    const formulaGroup = critical.get('[data-category="formula"]')
    const sourceGroup = critical.get('[data-category="source"]')

    expect(tableGroup.findAll('li')).toHaveLength(1)
    expect(tableGroup.get('li').text()).toContain(materialTableIssue)
    expect(tableGroup.get('li').text().endsWith(materialTableIssue)).toBe(true)
    expect(formulaGroup.findAll('li')).toHaveLength(1)
    expect(sourceGroup.findAll('li')).toHaveLength(1)
    expect(critical.text()).toContain('另有 2 项，展开全部质量事项查看全文。')
    expect(wrapper.get('[data-testid="paper-task-quality-panel"]').text()).toContain('工具／格式能力限制：1 项')

    const disclosure = wrapper.get('[data-testid="paper-task-quality-details"]')
    await disclosure.get('summary').trigger('click')
    const expandedText = disclosure.text()
    for (const issue of allIssues) expect(expandedText).toContain(issue)
    expect(disclosure.get('[data-category="source"]').text()).toContain(unverifiedImageIssue)

    wrapper.unmount()
  })
})
