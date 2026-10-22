export type PaperReaderPdfKind = 'original' | 'translated'
export type PaperReaderPdfAction = 'open' | 'download'
type Extra = 'figure1' | 'figure2' | 'table' | 'math' | 'references'
type Chapter = readonly [id: string, depth: 2 | 3, title: string, text: string, page: number, extra?: Extra]

export const paperReaderChapters: readonly Chapter[] = [
  ['abstract',2,'摘要','本文讨论如何在连续阅读中保留证据结构。一个合适的阅读界面不应要求读者先理解任务内部的诊断信息，而应先提供可读的正文、明确的来源与诚实的完整性状态。所有材料都是为排版评估编写的合成样例。',1],
  ['introduction',2,'1 引言','论文的阅读通常在整体理解与局部查证之间往返。读者先建立研究问题的轮廓，再沿着方法和结果追问证据是否充分。如果界面把每一段拆成独立卡片，篇章之间的联系会变弱；如果隐藏缺失范围，流畅的外观又可能掩盖真正的遗漏。',1],
  ['question',3,'1.1 研究问题','这里关注的不是模型是否能够生成一段像论文的文字，而是读者能否看见论证的全貌。一个简短摘要可以帮助定向，但不能代替主稿；章节目录帮助回到问题所在的位置，却不应把普通正文误识别为标题。',2],
  ['scope',3,'1.2 阅读范围','范围说明应与阅读稿一同出现，但不必占据整个首屏。若附录尚未形成可用译文，应明确指出其缺失，而不是把附录从界面和覆盖检查中同时删去。原论文入口仍可用于定位缺失部分。',2],
  ['method',2,'2 方法：保留证据链','合成流程分成原文准备、主稿生成和文档派生三个阶段。原文准备负责文本与图表的来源位置；主稿负责连续的中文表达；文档派生只消费已经批准的主稿。这样的分工能避免网页、Word 和 PDF 各自维护不一致的内容。',3],
  ['units',3,'2.1 从片段到篇章','自然段可以作为处理边界，却不应成为阅读界面的硬边界。生成过程中保留段落编号和来源页码，最终显示则依照章节形成连续文章。段落之间的承接需要在全文整合时复核，不能仅凭单批检查完成便宣称篇章正确。',3],
  ['figure-1',3,'2.2 证据流转示意','图 1 展示原文、统一主稿与文档派生的关系。图中每一条连接都应可解释：图表来自受控原始资产，三个输出格式共享内容，不通过重新翻译创建另一份看似完整的稿件。',4,'figure1'],
  ['notation',3,'2.3 数学与符号','行内符号应与正文保持一致，例如损失项 L 与权重 λ。若数学被提取为乱码，排版工具不能替它恢复含义；无法可靠还原的公式应保留来源并显示简短提示，而不是由模型静默猜测。',4,'math'],
  ['experiment',2,'3 合成实验','下表用于观察数值、表头和单位在阅读栏中的呈现方式，不是研究结果。数字只是合成夹具。它帮助检查手机上是否可单独横向滚动表格，以及桌面上正文栏是否足够容纳列名。',5],
  ['settings',3,'3.1 样例设置','样例设置使用相同的正文和状态切换布局，使比较集中在阅读结构上。正文宽度、字体与段落内容不随布局随机改变，避免将内容差异误认为版式优势。桌面和手机均保留同一份章节与图表。',5],
  ['table-1',3,'3.2 数值结果','表 1 中的覆盖数量和耗时仅用于版面测试。它们不能表示翻译准确率，也不能证明文档已经完成质检。正式系统应将读者需要的结果与内部审计指标分离。',6,'table'],
  ['figure-2',3,'3.3 误差与分布','图 2 使用合成柱形图比较不同条件。图注应紧随图片，不因章节导航或侧栏而被切开。切换到未完成预览时，此图会在原位置显示缺失提示，不留下空白的“已完成”图像区域。',6,'figure2'],
  ['discussion',2,'4 讨论','可信输出不仅依赖生成内容，也依赖状态表达。可用预览可以让读者尽早开始阅读，但它仍是未完成的材料。只有符合全文覆盖与必要检查要求，才可以将结果升级为完整成品；界面不应借省略警告来推动这个升级。',7],
  ['limitations',3,'4.1 局限','本原型不处理真实论文，不测试 Markdown 解析，也没有运行任何模型。页面里的 MathML、图和表为受控内容，因此它们在这里显示正常并不意味着生产环境的数学提取或安全渲染已经实现。',7],
  ['reader',3,'4.2 阅读节奏','正文采用较大的中文衬线字体与适宜栏宽。章节之间的留白承担换气作用，图表的浅色背景仅用于分辨边界。较长的目录可以在自己的区域滚动，不必让读者先滚到文章底部才能找到附录。',8],
  ['documents',3,'4.3 译文与原论文','打开译文 PDF 应打开已经存在的译文文件，下载操作应取得同一文件。原论文是另一份文档，即使译文尚未就绪，也不能用原论文冒充译文入口。本原型通过两个不同的合成 PDF 文件验证这一区分。',8],
  ['conclusion',2,'5 结论','连续长文、独立章节导航和诚实的文档状态共同构成阅读契约。最终选择应根据维护者的实际阅读方式确认，而不是由原型替人做决定。确定布局后，才将相应合同接入真实主稿与安全渲染流程。',9],
  ['appendix-a',2,'附录 A：术语说明','主稿指同一份内容依据，不等同于任一显示格式。可用预览是明确标记为未完成、但已有内容可以阅读的材料。完整成品则需要符合已约定的覆盖与检查条件。本原型的“完整样例”只是一种模拟状态。',10],
  ['appendix-b',2,'附录 B：复现说明','合成夹具保留固定的内容顺序与来源页码，可在三种布局下重复观察。生成译文 PDF 的按钮不会进行实际翻译，它仅从 ASCII 内容创建用于识别身份的单页 PDF。真正的格式派生和文档视觉质检仍需后续实现。',11],
  ['references',2,'参考文献','以下书目全部虚构，仅用于观察英文参考文献换行；没有真实 DOI、外部链接或可验证的研究主张。',12,'references'],
]

export function createPaperReaderPdf(kind: PaperReaderPdfKind): Blob {
  // ASCII keeps PDF character offsets identical to byte offsets.
  const stream = `BT /F1 16 Tf 50 735 Td (${kind.toUpperCase()} SYNTHETIC PDF FIXTURE) Tj 0 -36 Td /F1 11 Tf (UI prototype only - no real paper or translation.) Tj 0 -22 Td (This fixture verifies document identity and open/download actions.) Tj ET\n`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object,index) => { offsets.push(pdf.length); pdf += `${index+1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(offset => String(offset).padStart(10,'0')+' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Blob([pdf], { type: 'application/pdf' })
}
