export type PortalRouteKey =
  | 'home'
  | 'blog'
  | 'projects'
  | 'movies'
  | 'anime'
  | 'music'
  | 'tools'
  | 'life'
  | 'notes'
  | 'about'

export interface PortalNavItem {
  readonly key: PortalRouteKey
  readonly path: string
  readonly labelZh: string
  readonly labelJa: string
  readonly englishLabel: string
  readonly descriptionZh: string
  readonly descriptionJa: string
  readonly testId: string
  readonly appearsOnHome: boolean
}

export interface PortalCategory extends PortalNavItem {
  readonly appearsOnHome: true
}

const portalNavItemsByKey = {
  home: { key: 'home', path: '/', labelZh: '首页', labelJa: 'ホーム', englishLabel: 'HOME', descriptionZh: '返回门户首页', descriptionJa: 'ポータルのホームへ', testId: 'nav-link-home', appearsOnHome: false },
  blog: { key: 'blog', path: '/blog', labelZh: '博客文章', labelJa: 'ブログ', englishLabel: 'BLOG', descriptionZh: '技术文章与学习记录', descriptionJa: '技術記事と学習記録', testId: 'nav-link-blog', appearsOnHome: true },
  projects: { key: 'projects', path: '/projects', labelZh: '开源作品', labelJa: 'オープンソース', englishLabel: 'PROJECTS', descriptionZh: '开源项目与实验作品', descriptionJa: 'オープンソースと実験作品', testId: 'nav-link-projects', appearsOnHome: true },
  movies: { key: 'movies', path: '/movies', labelZh: '电影推荐', labelJa: '映画のおすすめ', englishLabel: 'MOVIES', descriptionZh: '喜欢的电影与剧集', descriptionJa: '好きな映画とドラマ', testId: 'nav-link-movies', appearsOnHome: true },
  anime: { key: 'anime', path: '/anime', labelZh: '动漫推荐', labelJa: 'アニメのおすすめ', englishLabel: 'ANIME', descriptionZh: '新番与经典动画', descriptionJa: '新作と名作アニメ', testId: 'nav-link-anime', appearsOnHome: true },
  music: { key: 'music', path: '/music', labelZh: '音乐推荐', labelJa: '音楽のおすすめ', englishLabel: 'MUSIC', descriptionZh: '音乐与歌单记录', descriptionJa: '音楽とプレイリスト', testId: 'nav-link-music', appearsOnHome: true },
  tools: { key: 'tools', path: '/tools', labelZh: '工具资源', labelJa: 'ツール・リソース', englishLabel: 'TOOLS', descriptionZh: '开发工具和学习资源', descriptionJa: '開発ツールと学習リソース', testId: 'nav-link-tools', appearsOnHome: true },
  life: { key: 'life', path: '/life', labelZh: '生活随笔', labelJa: '日常エッセイ', englishLabel: 'LIFE', descriptionZh: '日常生活与想法', descriptionJa: '日常生活と思考', testId: 'nav-link-life', appearsOnHome: true },
  notes: { key: 'notes', path: '/notes', labelZh: '技术笔记', labelJa: '技術ノート', englishLabel: 'NOTES', descriptionZh: '技术笔记和教程', descriptionJa: '技術ノートとチュートリアル', testId: 'nav-link-notes', appearsOnHome: true },
  about: { key: 'about', path: '/about', labelZh: '关于我', labelJa: '自己紹介', englishLabel: 'ABOUT', descriptionZh: '个人简介与经历', descriptionJa: 'プロフィールと経歴', testId: 'nav-link-about', appearsOnHome: false },
} as const satisfies Readonly<Record<PortalRouteKey, PortalNavItem>>

export const portalNavItems: readonly PortalNavItem[] = [
  portalNavItemsByKey.home,
  portalNavItemsByKey.blog,
  portalNavItemsByKey.projects,
  portalNavItemsByKey.movies,
  portalNavItemsByKey.anime,
  portalNavItemsByKey.music,
  portalNavItemsByKey.tools,
  portalNavItemsByKey.life,
  portalNavItemsByKey.notes,
  portalNavItemsByKey.about,
]

export const portalCategories: readonly PortalCategory[] = [
  portalNavItemsByKey.blog,
  portalNavItemsByKey.projects,
  portalNavItemsByKey.movies,
  portalNavItemsByKey.anime,
  portalNavItemsByKey.music,
  portalNavItemsByKey.tools,
  portalNavItemsByKey.life,
  portalNavItemsByKey.notes,
]

export function getPortalNavItem(key: PortalRouteKey): PortalNavItem {
  return portalNavItemsByKey[key]
}
