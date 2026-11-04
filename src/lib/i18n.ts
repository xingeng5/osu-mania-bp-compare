/** 界面文案。zh 是原文，en 是对照；新增文案时两边都要写。 */
export type Lang = 'zh' | 'en'

export const LANGS: Array<[Lang, string]> = [
  ['zh', '中文'],
  ['en', 'English'],
]

const LANG_KEY = 'mania-bp-compare.lang'

export function readLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* 存不下就只在本次会话生效 */
  }
}

type Entry = readonly [zh: string, en: string]

export const DICT = {
  /* ---------- 顶栏 ---------- */
  title: ['mania BP 对比', 'mania BP Compare'],
  langTitle: ['切换界面语言', 'Switch interface language'],
  placeholderA: ['玩家 A：用户名 / ID / 主页链接', 'Player A: username / ID / profile link'],
  placeholderB: ['玩家 B：用户名 / ID / 主页链接', 'Player B: username / ID / profile link'],
  recent: ['最近：', 'Recent:'],
  compare: ['对比', 'Compare'],
  loading: ['加载中…', 'Loading…'],

  /* ---------- 上下文 ---------- */
  keys: ['键数', 'Keys'],
  platform: ['平台', 'Client'],
  platformAll: ['全部', 'Any'],
  platformSame: ['相同平台', 'Same client'],
  platformStable: ['仅 STB', 'STB only'],
  platformLazer: ['仅 LZR', 'LZR only'],
  hiddenCross: ['已隐藏 {n} 条跨平台对比', 'Hid {n} cross-client comparisons'],
  crossNote: ['其中 {n} 条跨平台，pp差值仅供参考', '{n} are cross-client; pp diff is for reference only'],
  hiddenOther: ['已隐藏 {n} 条另一平台成绩', 'Hid {n} scores from the other client'],
  noVariant: ['{bucket} 无官方分项', 'no official {bucket} pp'],
  bpCount: ['BP {n} 条', '{n} BP scores'],
  totalPp: ['总 {pp}pp · {plays} plays', 'Total {pp}pp · {plays} plays'],

  /* ---------- 筛选条 ---------- */
  stars: ['星数', 'Stars'],
  year: ['年份', 'Year'],
  deltaFilter: ['|pp差值| ≥', '|pp diff| ≥'],
  reset: ['重置', 'Reset'],
  filteredOut: ['筛选掉 {n} 条', '{n} filtered out'],
  all: ['全部', 'All'],

  /* ---------- 视图 ---------- */
  viewSide: ['并排 {n}', 'Side by side {n}'],
  viewBoth: ['同图 {n}', 'Same map {n}'],
  viewOnlyA: ['仅A有 {n}', 'Only A {n}'],
  viewOnlyB: ['仅B有 {n}', 'Only B {n}'],
  collapse: ['收起设置 ▴', 'Hide settings ▴'],
  expand: ['展开设置 ▾', 'Show settings ▾'],

  sortRank: ['名次顺序', 'By rank'],
  sortDefault: ['默认顺序', 'Default'],
  sortPp: ['按 pp ↓', 'By pp ↓'],
  sortDAsc: ['pp差值 ↑', 'pp diff ↑'],
  sortDDesc: ['pp差值 ↓', 'pp diff ↓'],
  sortAbs: ['|pp差值| ↓', '|pp diff| ↓'],
  sortGain: ['可补 pp ↓', 'Gain ↓'],

  gradeATip: [
    'A 档：同图 + 同 rate mod + 同平台，pp差值 可以直接比',
    'Grade A: same map, same rate mod, same client — pp diff is directly comparable',
  ],
  gradeBTip: [
    'B 档：有一项口径不同（跨平台 / rate mod 不同 / 平台未知），只显示不算分',
    'Grade B: one condition differs (client / rate mod / unknown client) — shown but not scored',
  ],
  gradeCTip: ['C 档：不同图，仅并排', 'Grade C: different maps — layout only'],
  sameNotApplicable: ['「相同平台」在差集视图不适用', '"Same client" does not apply to the diff views'],

  /* ---------- 批量 ---------- */
  picked: ['已选 {n} 张', '{n} selected'],
  batchA: ['若A打出相同成绩 →', 'If A matched these →'],
  batchB: ['若B打出相同成绩 →', 'If B matched these →'],
  batchRows: ['（{n} 条）', '({n} rows)'],
  batchNote: [
    '按该键数下的完整 BP 一次性重算，不是逐条相加',
    'Recomputed against the full BP set in one pass, not summed row by row',
  ],
  selectAll: ['全选可见', 'Select all'],
  clear: ['清空', 'Clear'],

  /* ---------- 表格 ---------- */
  emptyState: [
    '该键数 / 平台 / 筛选条件下没有可比数据，试试切换键数、放宽容差或把平台改成「全部」',
    'No comparable data for these keys / client / filters. Try another keymode, a wider delta, or set the client to "Any".',
  ],
  pickTitle: ['选中这张图，参与下方的批量增益计算', 'Select this map for the batch gain calculation below'],
  notPlayed: ['未打出', 'Not played'],
  clientEvidence: ['平台判定：{evidence}', 'Client evidence: {evidence}'],
  gainTitle: [
    '若 {who} 也打到这张图 {pp}pp，预计落在第 {rank} 位，加权总 pp +{gain}',
    'If {who} scored {pp}pp here, it would land at #{rank}, weighted total pp +{gain}',
  ],

  /* ---------- 首屏提示 ---------- */
  hintTitle: [
    '输入两个 mania 玩家的名字开始对比；同一键数、同一平台口径下的 BP 并排显示。',
    'Enter two mania players to compare their top plays under the same keymode and client.',
  ],
  hintSub: [
    '支持用户名 / 数字 ID / osu 主页链接。数据来自官方 API v2，top100 为上限。',
    'Accepts username / numeric ID / osu profile link. Data comes from the official API v2, capped at top 100.',
  ],

  /* ---------- 错误 ---------- */
  errBothRequired: [
    '请填写两个玩家（用户名 / 数字 ID / 主页链接）',
    'Enter two players (username / numeric ID / profile link)',
  ],
  errNotFound: ['玩家不存在，或该玩家没有 mania 资料', 'Player not found, or they have no mania profile'],
  errRateLimited: ['请求过于频繁，被 osu! 限流了，请等一分钟再试', 'Rate limited by osu!. Wait a minute and try again'],
  errAuth: [
    'OAuth 鉴权失败：检查 .env.local 的 Client ID / Secret',
    'OAuth failed: check the Client ID / Secret in .env.local',
  ],
  errHttp: ['请求失败 (HTTP {status})', 'Request failed (HTTP {status})'],

  /* ---------- A/B/C 档原因 ---------- */
  reasonSingle: [
    '另一方没有这张图的成绩，pp差值按 0pp 计，只能看差距不能当水平差',
    'The other side has no score here; pp diff is measured from 0pp, so it shows the gap, not the skill gap',
  ],
  reasonDiffMap: ['不同图，只能并排看，不能算分', 'Different maps: layout only, no scoring'],
  reasonUnknownPlatform: ['有一侧平台无法判定', 'One side has an undetermined client'],
  reasonCrossPlatform: [
    '跨平台（STB vs LZR），两家 pp 算法不同',
    'Cross-client (STB vs LZR): the two pp algorithms differ',
  ],
  reasonRateDiff: ['rate mod 不同（{a} vs {b}）', 'Different rate mods ({a} vs {b})'],
  reasonAllSame: ['同图 · 同 rate mod · 同平台，可直接比', 'Same map · same rate mod · same client — comparable'],
} satisfies Record<string, Entry>

export type MsgKey = keyof typeof DICT

/** `{name}` 占位替换；缺值时保留占位符，方便发现漏传。 */
export function t(lang: Lang, key: MsgKey, vars?: Record<string, string | number>): string {
  const idx = lang === 'zh' ? 0 : 1
  const text = DICT[key][idx]
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

/** 列表项拼接用（中文用「；」，英文用「; 」）。 */
export function joinReasons(lang: Lang, parts: string[]): string {
  return parts.join(lang === 'zh' ? '；' : '; ')
}