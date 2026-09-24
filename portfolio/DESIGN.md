# Lonelyyang3 和风门户设计系统

## 0. 参考合同

本设计系统记录已确认的页面结构、交互和材质方向。文中标为“观测值”的尺寸用于校准响应式实现，设计令牌和 CSS 表达均为近似值，不构成像素级复刻承诺。参考站品牌、Logo、角色、插画、纸张图片、原站文案与社交资产均不得复制或下载到成品；加载 Logo 的五张图片分别承载 `lonely`、`yang`、`3`、coral icon、vertical `LONELYYANG3` wordmark，全部是用户拥有的预定位透明 RGBA PNG，不含任何参考站图片字节。材质只能用本站既有 CSS 纸张令牌重建。除已在 `ASSET-SOURCES.md` 记录权利来源的用户提供或生成品牌图片外，现有开发期临时占位素材最终上线前必须替换为用户拥有权利或明确获授权的图片。

### 0.1 标注编号

| ID | 观测区域 | 设计要求 |
|---|---|---|
| `H-01` | 左上品牌区域 | 用户提供的 `Lonelyyang3` 墨迹主字标与独立双语副品牌图片组成的双图品牌栈 |
| `H-03` | 左侧分类区域 | 八个分类的竖排入口 |
| `H-04` | 左下媒体区域 | 无媒体时显示和纸占位，有媒体时显示封面与播放入口 |
| `H-05` | 右侧窄轨 | 固定右侧导航轨与菜单触发器 |
| `H-06` | 左侧信息区与右侧主视觉 | 内容壳使用约 `575fr / 1211fr` 双轨，并在两轨间保留响应式 `24–39px` 间隙；固定右轨不计入轨道比例 |
| `H-07` | 右侧窄轨中段与底部 | 菜单触发器在轨内垂直居中，社交链接固定在轨底部 |
| `H-08` | `1920×2566` 完整主视觉至 INFORMATION | 主视觉完整显示后，仅在其底缘形成浅斜向纸层重叠与阴影，再进入 INFORMATION；不做水平硬切或中途裁切 |
| `N-01` | 桌面抽屉 | 目标宽度约 `690px` 的竖排分类抽屉，分类均可点击且内容可在内部滚动 |
| `F-01` | INFORMATION 左栏 | 按日期倒序的文章时间线左列 |
| `F-02` | INFORMATION 右栏 | 同一时间线的右列，不得重复左列文章 |

## 1. 设计原则

1. **画面先于界面**：首页以左侧水彩信息面、右侧完整长幅画面和其后的纸层叙事组成，不使用仪表盘、卡片墙或渐变 SaaS Hero。
2. **和纸与墨色**：页面材质以暖白和纸、左上朱红/粉色晕染及其下的淡黄、淡绿、淡蓝水彩纹理、深棕墨色为主。
3. **纵向节奏**：分类、导航和小标题优先使用竖排文字；正文保持横排，避免牺牲中文阅读效率。
4. **右侧导航是全站主骨架**：除首页进入阶段外，固定右侧导航轨始终不动，点击后抽屉紧贴其左缘向左展开；轨内菜单形态是唯一可见关闭控件。首页进入阶段只保留预留轨道宽度，右轨与抽屉均不挂载；进入 settled 后再挂载。
5. **长页叙事**：首屏之后自然进入文章流，不用互相独立的大圆角卡片切碎页面。
6. **内容不丢失**：保留现有分类、搜索、文章、项目、推荐、关于、国际化和主题能力，只改变表现层。

## 2. 色彩与材质令牌

### 2.1 浅色主题

| 令牌 | 值 | 用途 |
|---|---:|---|
| `--paper` | `#f8f5ed` | 主和纸背景 |
| `--paper-warm` | `#fffaf0` | 首屏左侧暖色雾化层 |
| `--ink` | `#2a0c00` | 主文字和墨色线条 |
| `--ink-soft` | `#6f5748` | 日期、说明文字 |
| `--vermilion` | `#e85845` | 印章、NEW 标记、焦点状态 |
| `--sakura` | `#efcbd5` | 淡粉纹样与悬停底色 |
| `--matcha` | `#dce8c8` | 淡绿纹样 |
| `--wagashi` | `#ead8ad` | 米黄棋盘纹样 |
| `--rule` | `rgba(42, 12, 0, 0.34)` | 点线分隔符 |
| `--nav-paper` | `rgba(250, 248, 242, 0.97)` | 导航轨与抽屉 |
| `--home-watercolor` | 多层 `radial-gradient()`，朱红/粉色位于左上，淡黄/淡绿/淡蓝向下扩散，并覆以 `paper-grain` | 首页左侧连续水彩纸面 |
| `--paper-surface-depth` | 暖纸遮罩 + `--paper-texture` | 桌面内容页的低对比纸纤维层 |
| `--ink-impression` | 墨色 18% 的亚像素压印 | 开放式内容页的轻微吸墨深度 |

### 2.2 深色主题

深色主题保留布局和纹样。参考图像的亮度降低并增加半透明墨色遮罩。视觉验收以浅色主题为主要基准，深色主题不得改变尺寸与信息结构。

| 令牌 | 值 |
|---|---:|
| `--paper` | `#171b22` |
| `--paper-warm` | `#20232b` |
| `--ink` | `#f2eadb` |
| `--ink-soft` | `#c6b9a8` |
| `--vermilion` | `#ef7867` |
| `--sakura` | `#5d404b` |
| `--matcha` | `#3f4c3c` |
| `--wagashi` | `#564b35` |
| `--rule` | `rgba(242, 234, 219, 0.34)` |
| `--nav-paper` | `rgba(23, 27, 34, 0.97)` |

### 2.3 材质

- `paper-grain`：低对比度、可平铺的纸纤维纹理。
- `paper-surface-depth`：仅在桌面 Blog/About 开放式页面层叠加暖纸遮罩与 `paper-grain`，内容容器保持透明；不得演变为卡片、面板或投影。
- `ink-impression`：仅为桌面 Blog/About 文字增加极轻的同色压印感，不得降低正文对比度或制造发光效果。
- `asanoha`：淡粉麻叶圆形纹样。
- `checker`：淡绿或米黄棋盘圆形纹样。
- `petal`：稀疏花瓣，仅作为静态背景或极轻微漂移；开启 `prefers-reduced-motion` 时完全静止。
- `home-watercolor`：令牌化的多重径向水彩与纸纤维层，左上为朱红和粉色，向下过渡到淡黄、淡绿、淡蓝；它是左侧信息面的连续底材，不得替换为单色、渐变 SaaS 面板或位图复制品。

## 3. 字体系统

- 首页、中文与日文标题共用明朝体令牌 `--font-mincho`：`YakuHanMP`, `Noto Serif JP`, `Yu Mincho`, `YuMincho`, `Hiragino Mincho ProN`, `Noto Serif SC`, `Songti SC`, `STSong`, `SimSun`, serif。
- 正文：优先同一明朝/宋体家族，避免现代无衬线破坏和风气质。
- 英文小标题：字距 `0.28em–0.42em`，如 `INFORMATION`、`ARCHIVE`。
- 品牌可见字形：主品牌使用由用户提供 RGB 源图确定性生成的透明运行时衍生图 `public/images/brand/lonelyyang3-wordmark.png`；语义名称仍由单一 `<h1 aria-label="Lonelyyang3">` 提供。其下使用同样生成的透明衍生图 `public/images/brand/lonelyyang3-myself-world.png` 作为双语副品牌图片，替代可见文本 `个人创作与学习记录`；两张图片均不是参考站 Logo 或图片。
- 正文字号：桌面 17–18px / 1.8，移动端 16px / 1.75。
- 竖排导航：`writing-mode: vertical-rl`，字符保持正向，不旋转中文。

## 4. 布局系统

### 4.0 首页实现令牌

以下令牌是本轮首页实现的唯一几何与动效来源；不得在组件内另写同义魔法值。

| 令牌 | 值 | 用途 |
|---|---:|---|
| `--right-rail-width-desktop` | `80px` | `1280px` 桌面固定右轨 |
| `--right-rail-width-tablet` | `64px` | `768px` 平板固定右轨 |
| `--right-rail-width-mobile` | `56px` | `375px` 手机固定右轨 |
| `--right-drawer-width-desktop` | `min(690px, calc(100vw - var(--right-rail-width-desktop)))` | 桌面抽屉约 `690px` 的实现近似值，包含 `1280px` 验收宽度 |
| `--home-info-track` | `575fr` | 桌面内容壳的信息轨实现近似值 |
| `--home-artwork-track` | `1211fr` | 桌面内容壳的高幅插画轨实现近似值 |
| `--home-track-gap` | `clamp(24px, 2.05vw, 39px)` | 双轨响应式间隙实现近似值 |
| `--home-brand-padding-block-start` | `162px` | 品牌顶部观测位置的桌面实现近似值；只能由信息区内边距产生 |
| `--home-artwork-intrinsic-width` | `1920` | 最终主视觉的固有宽度 |
| `--home-artwork-intrinsic-height` | `2566` | 最终主视觉的固有高度 |
| `--home-artwork-intrinsic-ratio` | `2566 / 1920` | 主视觉舞台由图片固有比例决定的高度 |
| `--home-intro-logo-start-at` | `500ms` | 首次绘制后的加载 Logo 激活等待时间 |
| `--home-intro-loading-piece-duration` | `900ms` | 五张预定位加载 Logo 图片各自从模糊透明态清晰显现的时长 |
| `--home-intro-loading-piece-blur` | `10px` | 每张加载 Logo 图片的初始模糊半径 |
| `--home-intro-loading-piece-offset` | `-12px` | 每层从最终位置上方进入并向下沉降至 `translateY(0)` 的初始偏移 |
| `--home-intro-loading-list-exit-duration` | `2000ms` | 完整加载 Logo 叠层从 `4400ms` 起退出的时长；最后一层在 `3800ms` 完成后保留 `600ms` 完整可读停留 |
| `--home-intro-loading-list-exit-blur` | `20px` | 完整加载 Logo 叠层退出终态的模糊半径 |
| `--home-intro-loading-logo-block-size` | `min(80dvh, 1000px)` | `724 / 2172` 预定位画布的统一块轴尺寸；行内尺寸由固有比例推导 |
| `--home-intro-brand-visible-at` | `5900ms` | 完整横向字标和双语副品牌随 handoff 开始进入清晰终态的时间点 |
| `--home-brand-max-inline-desktop` | `680px` | 桌面字标最大行内尺寸 |
| `--home-brand-max-inline-tablet` | `640px` | 平板字标最大行内尺寸 |
| `--home-brand-max-inline-mobile` | `100%` | 手机字标最大行内尺寸 |
| `--home-brand-secondary-source-width` | `1829` | 双语副品牌原图固有宽度 |
| `--home-brand-secondary-source-height` | `860` | 双语副品牌原图固有高度 |
| `--home-brand-secondary-crop-height` | `516` | CSS 可视裁切窗口对应的源图高度 |
| `--home-brand-secondary-inline-desktop` | `72%` | 桌面副品牌相对主品牌容器的行内宽度 |
| `--home-brand-secondary-inline-tablet` | `78%` | 平板副品牌相对主品牌容器的行内宽度 |
| `--home-brand-secondary-inline-mobile` | `88%` | 手机副品牌相对主品牌容器的行内宽度 |
| `--home-brand-stack-gap` | `clamp(10px, 1vw, 18px)` | 主字标与双语副品牌裁切窗口之间的垂直间距 |
| `--home-intro-artwork-start-edge` | `50dvh` | 固定加载图初始位置的底边锚点，使全宽图片底边位于视口中点 |
| `--home-intro-artwork-entry-blur` | `32px` | 固定加载图显现初态的强扩散模糊；在下落期间继续收敛至清晰终态 |
| `--home-intro-artwork-reveal-at` | `3800ms` | 固定加载图从视口中点底边锚点开始以模糊透明态显现的时间点 |
| `--home-intro-artwork-drop-start` | `4400ms` | 固定加载图开始落位的时间点 |
| `--home-intro-artwork-drop-duration` | `2000ms` | 固定加载图落至 `translateY(0)` 的时长；同时复用为从 `3800ms` 开始的透明度与模糊收敛时长 |
| `--home-intro-artwork-drop-ease` | `cubic-bezier(.4, 0, .8, 1)` | 固定加载图落位及模糊收敛缓动 |
| `--home-intro-handoff-at` | `5900ms` | 加载层向正常流完整主视觉交接的时间点 |
| `--home-intro-overlay-exit-duration` | `2000ms` | 加载覆盖层退出时长 |
| `--home-intro-overlay-exit-ease` | `cubic-bezier(.83, 0, .17, 1)` | 加载覆盖层退出缓动 |
| `--home-intro-settled-at` | `7900ms` | 覆盖层退出完成、共享 settled 状态变为 `true` 且右轨/抽屉可挂载的时间点 |
| `--home-motion-reduced` | `1ms` | 减弱动态时的非零过渡时长 |
| `--home-paper-depth-desktop` | `66px` | 桌面浅叠纸深度实现近似值；`58–74px` 为可接受验收带 |
| `--home-paper-depth-tablet` | `52px` | `768px` 浅叠纸深度实现近似值 |
| `--home-paper-depth-mobile` | `40px` | `375px` 浅叠纸深度实现近似值 |
| `--home-paper-diagonal` | `clamp(18px, 2vw, 32px)` | 浅斜上缘高差实现近似值；仅改变静态裁切，不参与动画 |

### 4.1 全站外壳

- 桌面端内容宽度为视口减去 `--right-rail-width-desktop` 导航轨。
- 首页是右轨常驻规则的唯一例外：`home-intro-settled` 为 `false` 时，右轨和抽屉均不挂载，因此不可见、不可聚焦，也不向辅助技术公告；内容壳仍预留对应断点的完整右轨 gutter，且该 gutter 位于全视口加载覆盖层下方，防止 settled 时产生 CLS。`home-intro-settled` 变为 `true` 后才挂载右轨和抽屉，并恢复本节其余全部滚动、定位与交互合同。
- 导航轨 `position: fixed; inset-block: 0; inset-inline-end: 0; width: 80px`。
- 抽屉关闭时只有品牌竖标、三竖线菜单按钮和辅助操作。
- 抽屉开启时，其右边缘严格等于固定导航轨左边缘，从该锚点向左展开；桌面目标宽度约 `690px`，在 `1280px` 视口也保持该目标，窄于可用空间时才收缩。内容区不重排，抽屉覆盖其上。
- 抽屉之外提供透明点击外部目标以关闭，不显示页面变暗、纸色遮罩或其他可见 dimmer。关闭只可通过点击外部目标、按 Escape 或右轨原菜单按钮变形后的关闭符号完成。
- 抽屉使用 `--paper`、`--paper-warm`、`--nav-paper` 与既有 CSS `paper-grain` 构成无图片暖纸面；不得引用、复制或下载参考站纸张图片。抽屉内容独立使用 `overflow-y: auto`，长菜单只在面板内部滚动。
- 页面浏览器滚动条始终存在，打开或关闭抽屉都不得锁定、切换或补偿 `body` 滚动。固定导航轨自身不滚动且开闭期间保持静止。
- `1920px` 桌面截图的观测几何为：`575px` 信息区 + `39px` 轨间隙 + `1211px` 固有比例图片 + `80px` 固定右轨 = `1905px` CSS 布局宽度，另有约 `15px` 浏览器滚动条位于内容几何之外。该观测值用于校准比例，不应被写成所有视口上的固定像素宽度。

### 4.2 首页首屏

- `HomeVisual` 不再是全幅背景 Hero。桌面内容壳宽度为 CSS 布局视口减去 `--right-rail-width-desktop`，内部使用 `minmax(0, var(--home-info-track)) minmax(0, var(--home-artwork-track))` 双轨与 `--home-track-gap`；两轨比例约为 `575 / 1211`，固定右轨和浏览器滚动条均独立于该比例。
- 右侧最终主视觉是正常文档流中的 `1920×2566` 图片，使用 `width: 100%; height: auto`。不得设置固定 `svh` 艺术高度、`100svh` 首屏高度、溢出裁切或 `object-fit: cover`。其 `2566 / 1920` 固有比例决定主视觉舞台高度，完整图像必须先出现。
- 信息区由上至下：
  1. 由用户提供源图生成的透明 `Lonelyyang3` 主字标图片与独立双语副品牌图片；副品牌图片替代并移除可见文本 `个人创作与学习记录`。
  2. 八个内容分类，采用参考图的竖排分栏。
  3. 预留媒体位；无媒体时显示克制的和纸占位，不展示假播放按钮。
- Hero 信息区不包含“最新更新”行；最新文章仍完整保留在 4.3 `INFORMATION / 最近更新` 中。
- 固定加载层在水彩加载图上方按顺序居中叠放五张用户拥有的 `724×2172` 透明 RGBA PNG：`lonely`、`yang`、`3`、coral icon、vertical `LONELYYANG3` wordmark。每张图片内部已带预定位坐标，运行时资产从源文件逐字节复制，所有列表项共享同一画布；CSS 不得重新定位图片内容。加载层尺寸只使用 `--home-intro-loading-logo-block-size` 并按 `724 / 2172` 推导宽度，以保证 `2560×1440` 清晰可见且适配移动端。
- 信息区使用 `--home-watercolor` 的连续水彩纸面，确保文字可读但不形成硬卡片。`Lonelyyang3` 的可见字形来自同一个 `2048×682` 透明图片字标，按断点分别受 `--home-brand-max-inline-desktop`、`--home-brand-max-inline-tablet`、`--home-brand-max-inline-mobile` 限制，并始终保持 `2048 / 682` 固有宽高比和 `height: auto`；不得拉伸、与主视觉重叠、被信息区裁切或造成水平溢出。其顶部约 `162px` 是观测位置，CSS 只能用信息区的 `padding-block-start: var(--home-brand-padding-block-start)` 近似实现，不得用 `transform`、绝对垂直居中或容器居中伪造位置。
- 双语副品牌在主字标下方居中，间距只使用 `--home-brand-stack-gap`。其 CSS 裁切容器使用 `aspect-ratio: var(--home-brand-secondary-source-width) / var(--home-brand-secondary-crop-height)` 与 `overflow: hidden`；`1829×860` 透明运行时图片保持源图比例和完整像素几何，定位在容器块轴 `50%`，只使用静态 `translateY(-50%)` 居中。裁切窗口必须保留粉色带和图片内两行文字，不得另行生成栅格裁图或在断点间改变裁切焦点。
- 最终主视觉承担唯一图像焦点，不叠放信息文案，也不按人物焦点裁切。用户提供的 `reference/asset-sources/kv2.png` 按字节复制到 `public/images/home/hero-main.png`，以 `1920×2566` 完整比例用于加载层和正常文档流主图。
- 首页进入 settled 后，首屏右边缘显示固定导航轨。菜单触发器在轨道可用高度内垂直居中；社交链接组锚定轨底部，并与菜单触发器保持独立布局槽位。进入阶段不挂载右轨或抽屉，但必须在加载覆盖层下方保留相同宽度的右轨 gutter。

### 4.2.1 主视觉至 INFORMATION 的纸层过渡

- `HomePaperTransition` 只能在完整 `1920×2566` 主视觉的底缘形成浅斜向重叠、窄阴影边与短留白；不得提前遮住主体内容、用水平分隔线或把过渡画进插画位图。
- 过渡层只与完整图像的底缘重叠，随后才是纸面和 INFORMATION。其深度分别使用 `--home-paper-depth-desktop`、`--home-paper-depth-tablet`、`--home-paper-depth-mobile`；上缘高差使用 `--home-paper-diagonal`。纸层颜色只能引用 `--paper`、`--paper-warm` 与 `--rule`。
- 阴影必须低对比且贴近浅斜边，只用于表达两张纸的轻微层差；不得恢复为深折页、宽遮罩或 `180px` 大留白。
- 过渡层不承载正文、链接或滚动触发逻辑；其后才开始 `PaperSectionHeading` 和 INFORMATION 内容，确保语义顺序稳定。

### 4.3 首页文章流

- 首屏下方为 `INFORMATION / 最近更新` 区域，采用和纸背景与淡色纹样。
- 桌面双栏：左栏约 58%，展示最新文章时间线；右栏约 42%，展示精选或后续文章。
- 先对文章按日期降序得到唯一数组；数组索引为偶数的文章进入左栏，奇数进入右栏。因此桌面按“左上 → 右上 → 左下 → 右下”读取时仍保持全局时间顺序，且两栏不重复。
- 每条文章以日期、分类、标题组成，条目之间使用墨色点线；不使用大圆角卡片。
- 页面继续向下可接关于摘要、项目精选和页脚，但维持相同开放式排版。

### 4.4 分类列表页

- 顶部使用竖排中文分类名 + 拉开字距的英文副标题。
- 主体为单栏或宽窄双栏的时间线列表，不复用旧三列卡片网格。
- 标签作为小型印章式文本，不使用胶囊按钮堆叠。
- 筛选器采用横排文本标签和细线状态，不使用彩色圆角按钮。

### 4.5 文章详情页

- 对外文章 URL 为 `/blog/:slug`；当前由 `app/pages/blog/[...slug].vue` 统一处理 canonical Content path 和 locale 前缀。
- 顶部展示分类、日期、标题和封面；封面只能使用用户拥有或获授权的临时图片，缺图则显示纹样背景。
- 正文宽度 680–760px，居中偏左，保留右侧导航轨和充足留白。
- 代码块、引用、图片和标题均使用同一和纸/墨色体系。
- 详情页底部提供上一篇、下一篇和返回分类。

### 4.6 其他页面

- 项目、电影、动漫、音乐、工具、生活、笔记和关于页共享全站外壳。
- 内容型页面使用时间线；项目型页面可使用开放式图文列表，但不采用后台式卡片网格。
- 关于页使用大幅人物/环境图、竖排自我介绍标题、横排正文和经历时间线。

## 5. 组件合同

### `RightNavRail`

- 属性：`open`。
- 事件：`toggle`、`close`。
- 菜单按钮必须支持键盘，并公开 `aria-expanded` 和 `aria-controls`；焦点陷阱、Escape、外部点击关闭和焦点恢复由 `RightNavDrawer` 负责，但它不得锁定或切换页面滚动。
- 菜单触发器位于右轨垂直中心；轨底社交链接容器使用 `data-testid="right-nav-share-links"`。抽屉开闭期间固定轨的位置、宽度和布局均不变，面板右边缘始终对齐轨左边缘；该调整不得改变 80/64/56px 轨宽、抽屉覆盖方式或 `RightNavDrawer` 的职责边界。

### `RightNavDrawer`

- 展示全部十个导航入口，使用竖排中文标签。
- 活跃项以朱红印章点和墨色强调表示。
- 面板右边缘锚定固定导航轨左边缘，展开和关闭仅使用 `transform` 与 `opacity`，时长固定为 `700ms`；不移动导航轨，不产生可见页面 dimming。
- 桌面面板宽度使用 `--right-drawer-width-desktop`，目标约 `690px`，包括 `1280px` 视口；面板是由既有 CSS 纸张令牌构成的无图片暖纸面，内容超长时仅面板内部 `overflow-y: auto`。
- 抽屉内部不得渲染第二个可见关闭按钮。右轨菜单按钮形态切换是唯一可见关闭控件；透明点击外部目标只承担点击关闭，不具有视觉表面。
- 抽屉底部统一放置搜索、语言切换和主题切换；这些控件在所有断点只渲染一份，不在窄轨重复渲染。
- 搜索默认显示图标与“搜索”标签，点击后在抽屉底部展开横排输入框；语言与主题是带文字标签的按钮。

### `HomeVisual`

- 外层根节点保留现有 `data-testid="home-visual"`，负责每次进入首页的阶段与滚动提示，并承载 `data-intro-mode="first|reduced"` 和 `data-intro-state="brand|artwork|handoff|settled"`。
- 内层信息/插画布局网格使用 `data-testid="home-visual-stage"`，负责双轨或响应式单列排布。最终主视觉位于该节点的正常流内，图片保持 `width: 100%; height: auto`。
- 信息节点使用 `data-testid="home-visual-info"`；最终主视觉容器使用 `data-testid="home-artwork-panel"`。独立固定加载图使用 `data-testid="home-artwork-loading"`，只服务进入动画，不能替代或裁切正常流最终主视觉。背景、插画与文本必须分层，不能把标注稿直接作为整页截图使用。
- 品牌必须保持单一语义标题 `<h1 id="home-brand" aria-label="Lonelyyang3">`，且其中只保留一张最终横向图片 `public/images/brand/lonelyyang3-wordmark.png`。加载装饰层是固定覆盖层内的单一 `<ul aria-hidden="true">`，从只读路径数组严格按顺序渲染 `/images/brand/home-intro/logo01-lonely-clean.png`、`/images/brand/home-intro/logo02-yang-clean.png`、`/images/brand/home-intro/logo03-3.png`、`/images/brand/home-intro/logo04-icon.png`、`/images/brand/home-intro/logo05-wordmark.png`，语义层依次为 `lonely`、`yang`、`3`、coral icon、vertical `LONELYYANG3` wordmark。五张图片均为用户拥有、带 alpha 的预定位透明 RGBA `724×2172` 画布，由生成器从对应源文件逐字节复制到运行时路径；每个 `<li>` 绝对定位到同一画布，不使用切片、`clip-path`、逐件类名或 JavaScript 逐件计时器。
- 正常动态模式先保留 `500ms` 首次绘制等待，再由定时状态设置 `data-intro-started="true"`。五层分别从 `opacity: 0`、`blur(10px)`、`translateY(-12px)` 经 `900ms ease` 清晰并向下沉降至 `translateY(0)`；相对延迟为 `0 / 600 / 1200 / 1800 / 2400ms`，因此绝对开始时间为 `500 / 1100 / 1700 / 2300 / 2900ms`，完成时间为 `1400 / 2000 / 2600 / 3200 / 3800ms`。完整五层 Logo 保持清晰可读 `600ms`，随后 `data-intro-drop="true"` 在 `4400ms` 统一触发整个列表以 `2000ms ease` 过渡到 `opacity: 0`、`blur(20px)`；该退出只改变列表的透明度与滤镜，并与固定加载图从同一时刻开始的下落及持续清晰化自然重叠。尺寸、预定位画布内容和布局几何均不参与动画。
- 双语副品牌仍是独立的 `<img src="/images/brand/lonelyyang3-myself-world.png" alt="MySelf-World，我与我的世界">`，位于主标题下方的既有 CSS 裁切窗口内。它与最终横向字标在加载 Logo 组装期间保持不可见，只在 `data-intro-brand-visible="true"`、`handoff` 或 `settled` 显示；不再有 `1500ms` 的独立延迟揭示，也不在 `artwork` 阶段提前出现。
- 两张最终运行时品牌图片由 `scripts/generate-brand-assets.mjs` 从用户提供的透明 RGBA PNG 逐字节复制。生成器只验证格式、Alpha 通道、固有尺寸以及透明/可见像素，不去底、不重编码，因此保留原始颜色、透明边缘和抗锯齿笔刷细节。运行时使用默认 `mix-blend-mode: normal`：浅色主题以 `invert(0) hue-rotate(0deg)` 保持原色，深色主题以 `invert(1) hue-rotate(180deg)` 只处理 RGB 并保留 alpha。使用 `node scripts/generate-brand-assets.mjs` 复制，使用 `node scripts/generate-brand-assets.mjs --check` 验证。主题切换与生成过程均不得改变主图 `2048 / 682` 比例、副图 `1829 / 860` 比例、裁切窗口或布局尺寸。
- 每次刷新和每次路由重新进入首页都必须复用品牌、信息、固定加载图、加载 Logo 列表、最终主视觉与 INFORMATION 的同一 DOM，并执行相同的 `500ms / 3800ms / 4400ms / 5900ms / 7900ms` 时序；只能通过外层根节点已有的 `data-intro-mode`、`data-intro-state`、`data-intro-started`、`data-intro-brand-visible`、`data-intro-drop` 和时长令牌切换这些节点的视觉状态。正常动态模式的 `data-intro-started` 必须通过既有可清理定时器在 `500ms` 激活；减弱动态模式复用相同内容 DOM，但隐藏加载 Logo 并立即进入 settled。
- 布局层使用 SSR-safe 共享状态 `useState<boolean>('home-intro-settled', () => false)`：首页正常进入期间始终为 `false`，只在 `7900ms` settled 时变为 `true`；`prefers-reduced-motion: reduce` 下立即为 `true`。右轨和抽屉由布局层依据该状态条件挂载，不扩展 `HomeVisual` 或导航组件属性。

### `HomePaperTransition`

- 根节点使用 `data-testid="home-paper-transition"`，位于 `HomeVisual` 之后、`PaperSectionHeading` 之前。
- 只负责斜向纸层和留白，不接收内容数据，不抢占焦点，使用 `aria-hidden="true"`；静态几何在所有进入阶段保持一致，防止布局位移。

### `VerticalCategoryNav`

- 首页摘要与抽屉菜单共用数据源。
- 可独立调整密度，路径来自现有分类配置。

### `ChronologicalFeed`

- 输入按日期排序的内容数组。
- 支持首页双栏与分类页单栏两种变体。
- 文章链接统一使用 Content 3 的 `path` 字段。

### `PaperSectionHeading`

- 朱红印章、英文大字距标题、中文说明三层结构。

### `ArticleProse`

- 包装 Nuxt Content 渲染结果，控制正文宽度、代码、图片、引用和标题节奏。

### `ScrollToTop`

- 滚动超过 300px 后显示在固定右轨左侧，不得被导航轨遮挡。
- 使用方形朱红边框、暖和纸底色的印章外观，不使用圆形、阴影或悬浮卡片样式。
- 显隐与悬停仅使用 `opacity` 和 `transform`；`prefers-reduced-motion` 下取消平滑滚动并将过渡压缩至 1ms。

## 6. 交互与动效

- 导航展开：固定右轨保持不动，抽屉以其右边缘等于轨左边缘为锚点，从 `translateX(30px) + opacity(0)` 到 `translateX(0) + opacity(1)`，固定 `700ms`。外部透明点击目标可关闭抽屉，但不产生可见遮罩或页面 dimming。
- 三竖线菜单图标在开启时转化为关闭符号，保持原位置与 44px 以上点击区域。
- 文章条目悬停仅改变标题颜色、点线透明度与 2–4px 位移，避免浮起卡片效果。
- 首页进入严格按 `brand → artwork → handoff → settled` 推进。每次刷新和每次路由重新进入首页均使用以下相同时序，不记录或读取用于加速进入的会话状态；证据只确认视觉顺序，具体 CSS 毫秒值是实现近似值：
  1. 固定加载层内的五张用户拥有、带 alpha 的预定位透明 RGBA PNG 共享同一 `724×2172` 绝对定位画布，语义顺序为 `lonely`、`yang`、`3`、coral icon、vertical `LONELYYANG3` wordmark；源文件按字节直接复制为运行时资产，不做变换。首次绘制等待 `500ms` 后激活，五层按绝对时间 `500 / 1100 / 1700 / 2300 / 2900ms` 从 `opacity: 0`、`blur(10px)`、`translateY(-12px)` 开始，以 `900ms ease` 清晰并向下沉降至最终位置，对应完成时间为 `1400 / 2000 / 2600 / 3200 / 3800ms`。完整五层 Logo 随后保持清晰可读 `600ms`，`4400ms` 时整个列表开始以 `2000ms ease` 只通过 `opacity` 与 `filter` 淡出并模糊至 `20px`；这一退出窗口与固定加载图的下落和持续清晰化重叠。最终横向字标与双语副品牌在组装和 `artwork` 阶段保持隐藏，`5900ms` 进入 handoff 时一起显示。
  2. 固定加载图独立于正常流最终主视觉，初态使用令牌化 `blur(32px)` 与 `opacity: 0`，并使用 `translateY(calc(50dvh - 全宽图片固有高度))` 使其底边锚定视口中点；在 `3.8s` 开始以强扩散模糊柔和显现，透明度和滤镜复用 `2s` 落位时长并持续至 `5.8s` 收敛到清晰终态。从 `4.4s` 起，图片同时以 `2s cubic-bezier(.4, 0, .8, 1)` 下落至 `translateY(0)`；因此清晰化有 `1.4s` 延续在下落窗口内，并与加载 Logo 从同一时刻开始的 `2000ms` 模糊淡出形成交叉过渡。该加载态锚点不改变正常流最终主视觉的来源、全宽尺寸或最终几何。
  3. `5.9s` 进入 handoff，完整正常流主视觉已是最终内容来源。加载覆盖层以 `2s cubic-bezier(.83, 0, .17, 1)` 退出，在 `7.9s` 才进入 settled、设置 `home-intro-settled = true` 并允许布局挂载右轨与抽屉；纸层只能在完整最终图像的底缘之后出现。
- 加载 Logo 只借用参考站“同位叠层从透明与模糊中逐步清晰、随后整组退出”的抽象动效语法；五张加载图片、最终横向字标和双语副品牌均来自用户拥有的本站资产。成品不复制、下载、热链、描摹或重绘参考站的 Logo、图片、品牌资产、专有笔画或任何原站图片字节，也不构成像素级克隆承诺。
- 品牌加载动画仅改变五层及整个列表的 `opacity`、`filter`，以及各层从 `translateY(-12px)` 到 `translateY(0)` 的合成层位移；不动画宽高、布局位置或画布内容。既有固定加载图继续只按原合同改变 `transform`、`opacity`、`filter`，其初始 `transform` 以 `50dvh` 为图片底边锚点；加载覆盖层和最终品牌交接继续使用既有属性。副品牌原图用于静态居中的 `translateY(-50%)` 不得动画；两张最终品牌图片的尺寸/位置/裁切几何、加载 Logo 的 `724×2172` 画布几何、最终主视觉的固有尺寸/高度/裁切几何、纸层斜角、滚动位置、`width`、`height`、`top`、`left` 和 `clip-path` 均不得参与逐帧动画。
- 除上述有叙事含义的首页阶段外，页面进入只使用轻微淡入，不对每个元素做装饰性动画。
- `prefers-reduced-motion: reduce` 下仍保留完整内容 DOM 和 settled 终态，隐藏五层加载 Logo，首次绘制即显示完整最终横向字标和清晰双语副品牌；深浅主题滤镜仍按主题合同保留。同时立即设置 `home-intro-settled = true` 并挂载右轨与抽屉，跳过加载图移动与覆盖层退出。其他确有必要的非品牌过渡可压缩至 `--home-motion-reduced`（约 `1ms`）；禁止平滑滚动、视差和延迟揭示。

## 7. 响应式规则

### 桌面（≥ 1024px）

- `1280px` 验收基准：内容壳始终预留 80px 右轨 gutter；剩余内容壳采用约 `575fr / 1211fr` 左侧水彩信息面/完整长幅主视觉双轨，并以 `--home-track-gap` 保持 `24–39px` 响应式间隙。主视觉以 `1920×2566` 的 `width: 100%; height: auto` 正常流显示，舞台高度由固有比例确定，不以 `100svh`、最小高度或裁切限制。双图品牌栈顶部位置由约 `162px` 的信息区内边距实现；主字标最大宽度使用 `--home-brand-max-inline-desktop`，副品牌宽度使用 `--home-brand-secondary-inline-desktop`，二者居中堆叠且不得触碰或覆盖主视觉、被信息轨裁切或引发页面水平溢出。settled 后挂载 80px 固定导航轨，菜单垂直居中、社交链接在轨底，约 `690px` 抽屉右边缘紧贴轨左边缘。
- `INFORMATION` 前使用约 `66px` 深的浅斜向重叠与窄阴影，`58–74px` 为桌面可接受验收带；首屏与内容流之间不得出现水平硬切或深折页。

### 平板（768–1023px）

- `768px` 验收基准：内容壳始终预留 `--right-rail-width-tablet` gutter；settled 后挂载相同宽度的导航轨，抽屉在可用宽度内收缩且右边缘紧贴轨左边缘。内容壳改为单列，完整主视觉以固有比例正常流显示，信息区不覆盖图片。纸层只在完整图片底缘形成约 `52px` 的浅斜重叠与阴影。
- 双图品牌栈在信息区可用宽度内居中堆叠；主字标最大宽度使用 `--home-brand-max-inline-tablet`，副品牌宽度使用 `--home-brand-secondary-inline-tablet`。两张图片及副品牌裁切窗口必须完整可辨，不得与后续主视觉重叠、被裁切出合同范围或产生水平溢出。
- 菜单仍在轨内垂直居中，社交链接仍在轨底；不得为平板复制第二套右轨或抽屉控件。

### 手机（< 768px）

- 内容壳始终预留右侧 `--right-rail-width-mobile` gutter；settled 后才挂载固定窄轨，轨内显示菜单触发器、简化品牌标记和轨底社交链接。搜索、语言与主题控件只在抽屉底部出现。抽屉开启后仍保持固定窄轨不动，面板右边缘对齐窄轨左边缘，轨内菜单切换为唯一可见关闭按钮。
- `375px` 验收基准：内容壳宽度为 `100vw - var(--right-rail-width-mobile)`，主视觉单列排列并以 `width: 100%; height: auto` 完整进入正常文档流，信息区不以覆盖层压在图片上。纸层仅在完整图片底缘形成约 `40px` 的浅斜重叠与阴影。
- 双图品牌栈在扣除右轨 gutter 后的可用宽度内居中堆叠；主字标最大宽度使用 `--home-brand-max-inline-mobile`，副品牌宽度使用 `--home-brand-secondary-inline-mobile`。两张图片及副品牌裁切窗口必须完整可辨，不得与主视觉重叠、被裁切出合同范围或造成任何水平滚动。
- 首屏继续使用同一张临时主图，不生成第二份资产，也不设置断点焦点裁切。390×844 与 375×667 均须允许用户自然滚动浏览完整图片；左侧文案不得覆盖图片内容。
- 分类从八列竖排改为可横向浏览的竖排组，触摸目标不小于 44px。
- 文章双栏合并为单栏，不允许横向滚动。

## 8. 可访问性与约束

- 普通文字对比度至少 4.5:1；装饰纹样不承担信息表达。
- 页面浏览器滚动条必须始终存在；抽屉开闭不得修改 `body`/页面的 `overflow`、不得锁定或切换背景滚动，也不得通过补偿内边距改变页面几何。抽屉自身内容使用内部滚动。
- 抽屉开启时把焦点移入菜单并陷阱在面板内；Escape、透明点击外部目标和右轨菜单形态均可关闭，关闭后焦点恢复至触发按钮。固定导航轨不移动，页面不显示可见 dimmer，且不得渲染重复的内部关闭按钮。
- 图片必须有与内容相关的替代文本；纯装饰纹样使用空 `alt`。
- 不使用 Emoji 作为结构性图标；菜单、搜索、主题与社交图标统一使用 SVG。
- 竖排文字必须在屏幕阅读器中保留正常语义顺序。
- 主品牌标题必须使用单一 `<h1 id="home-brand" aria-label="Lonelyyang3">` 保留可读名称；最终横向字标图片使用 `aria-hidden="true"` 与空 `alt`，避免重复朗读。固定加载层的 `<ul>` 与五张组装图片全部是装饰内容，统一 `aria-hidden="true"` 且图片使用空 `alt`。独立副品牌图片必须且只能使用 `alt="MySelf-World，我与我的世界"`，不得隐藏于可访问性树，也不得同时保留可见文本 `个人创作与学习记录`。初始透明与模糊只影响视觉，不移除语义；`prefers-reduced-motion: reduce` 下加载列表隐藏，两张最终品牌图片必须立即完整、清晰可见。
- 品牌、信息、插画、纸层过渡和 INFORMATION 在 DOM 中保持符合阅读顺序的稳定节点；进入阶段不得使用 `display: none`、`visibility: hidden` 或条件卸载隐藏这些可读内容。首页右轨与抽屉是唯一例外：`home-intro-settled` 为 `false` 时不挂载，因此不可见、不可聚焦且不向辅助技术公告；settled 后才挂载。
- 进入动画期间，未揭示的内容链接不得在视觉出现前进入异常焦点顺序，且右轨与抽屉不存在于焦点顺序或可访问性树中；settled 后键盘顺序必须与视觉顺序一致。右轨菜单触发器与每个社交链接的点击区域至少 44×44px，并具有可见焦点样式和可理解的 `aria-label`。
- 插画若传达内容必须提供与本站内容对应的替代文本；开发期参考站角色与参考站品牌不得写入替代文本。纯装饰纸层、纹样和遮罩使用空替代文本或 `aria-hidden="true"`。
- 动画不得引发 CLS；辅助技术无需等待 `5.9s` 即可读取首页主体内容。每次刷新、每次路由重新进入和 `prefers-reduced-motion` 都必须到达同一可访问 settled 状态，完整最终图片不依赖加载覆盖层才能被读取；右轨 gutter 的预留不得向辅助技术产生空导航公告。
- 自动化验收以现有外层根节点 `home-visual`，以及 `home-visual-stage`、`home-visual-info`、`home-artwork-panel`、`home-artwork-loading`、`home-paper-transition` 五个稳定 `data-testid` 为进入阶段测试缝；样式重构不得改名或按断点移除这些节点。`right-nav-share-links` 在 intro 期间必须不存在，只在 `home-intro-settled = true` 后随右轨挂载，并继续作为 settled 后稳定测试缝。

## 9. 素材策略与已接受设计债务

- 网页加载 `public/images/` 中的本地运行时文件，URL 使用 `/images/...`；页面不直接加载 `reference/asset-sources/` 中的来源输入。素材来源文档只描述各自明确列出的范围，不据此推断运行时文件的字节来源。
- 新增开发期临时素材必须由用户提供、归用户所有或明确获授权；不得下载、复制或热链参考站资产。已列于 `public/images/reference/deaimon/ASSET-SOURCES.md` 的文件是现有本地开发预览占位素材，并非已获生产使用许可的素材；生产前必须替换或重建为获准使用的素材。固定加载图与最终正常流图必须是分离层，不得以加载层裁切替代完整最终图像。
- 用户提供的 `reference/asset-sources/kv2.png` 是首页主图来源；展示合同是 `width: 100%; height: auto`，保持 `1920×2566` 完整比例。来源文件与运行时文件关系以 `ASSET-SOURCES.md` 记录为准。
- 上线前：替换除 `ASSET-SOURCES.md` 已确认权利来源的本站品牌素材之外的所有临时素材，同时保留完整比例、正常流接口、纸层交接和组件接口，不保留任何人物焦点裁切规则。
- 暗色主题不是参考稿的一部分，其视觉精度低于浅色主题，但功能必须保留。
- 参考站原 Logo、社交品牌图标与专有文案不进入成品。
- 用户提供/生成的 `reference/asset-sources/logo.png`、`reference/asset-sources/bdinfo.png`，以及运行时 `public/images/brand/home-intro/logo01-lonely-clean.png`、`logo02-yang-clean.png`、`logo03-3.png`、`logo04-icon.png`、`logo05-wordmark.png` 五张 `724×2172` 预定位透明 RGBA PNG，均是获准使用的本站品牌素材，不受“图片品牌禁用”约束；五张加载源图依次承载 `lonely`、`yang`、`3`、coral icon、vertical `LONELYYANG3` wordmark，带 alpha 且按字节复制到运行时路径，源文件与图片内部定位保持不变。最终横向字标与副品牌同样按字节复制；加载序列不得另行变换、裁切、缩放、重定位、去底、重排或生成深色主题变体。
- 首页加载 Logo 只可采用“同位预定位叠层从透明、模糊与轻微上方偏移中自上而下错峰清晰，并在 `4400ms` 整组退出”的抽象动效语法；不得复制、下载、热链、描摹或打包参考站的 Logo、图片、字体轮廓、品牌资产、其他专有视觉素材或原站图片字节，也不得宣称像素级复刻。最终横向 `lonelyyang3-wordmark.png` 与副品牌图片是独立 settled 品牌，不得由加载层替代。
- `public/images/reference/deaimon/ASSET-SOURCES.md` 记录的是该目录中的本地临时预览素材及其来源 URL 元数据，不表示页面会热链这些 URL。它们尚未完成权利清理，仅供开发预览，生产前必须替换或重建为获准使用的素材。
- 生产放行条件：运行时页面只可引用拥有或获授权的素材；未满足时只能声明“开发预览完成”，不能声明“生产素材就绪”。
