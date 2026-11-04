import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchPlayer, parseUserInput } from './api'
import { decodeShare, encodeShare, filtersFromShare } from './lib/url'
import { ALL_BUCKETS } from './lib/client'
import {
  applyFilters,
  applyPlatformToPairs,
  availableYears,
  buildPairs,
  countByBucket,
  countGrades,
  defaultBucket,
  DEFAULT_FILTERS,
  gradePair,
  minAbsDelta,
  platformMatch,
  select,
  variantPp,
  type GradeReason,
  type Pair,
  type SortKey,
} from './lib/compare'
import { batchGain, makeRows, sortRows, type RowGain } from './lib/pp'
import { joinReasons, LANGS, readLang, saveLang, t, type Lang, type MsgKey } from './lib/i18n'
import type { Filters, KeyBucket, PlatformFilter, Player, Play, RateMod, ViewKey } from './types'

const ROW_H = 88
const RECENT_KEY_A = 'mania-bp-compare.recent.a'
const RECENT_KEY_B = 'mania-bp-compare.recent.b'
const RECENT_KEY_LEGACY = 'mania-bp-compare.recent'

function readRecent(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

/** 最近名单分两侧；老版本只有一个共用列表，迁移成两边都用。 */
function initRecent(key: string): string[] {
  const own = readRecent(key)
  return own.length > 0 ? own : readRecent(RECENT_KEY_LEGACY)
}

function remember(key: string, name: string): string[] {
  const next = [name, ...readRecent(key).filter((x) => x !== name)].slice(0, 5)
  localStorage.setItem(key, JSON.stringify(next))
  return next
}

const modLabel = (p: Play) => [p.rateMod === 'NM' ? '' : p.rateMod, ...p.extraMods].filter(Boolean).join(' + ') || 'NM'

const clientLabel: Record<string, string> = { stable: 'STB', lazer: 'LZR', unknown: '?' }

/** 三档原因 code → 文案 key */
const REASON_KEY: Record<GradeReason['code'], MsgKey> = {
  single: 'reasonSingle',
  diffMap: 'reasonDiffMap',
  unknownPlatform: 'reasonUnknownPlatform',
  crossPlatform: 'reasonCrossPlatform',
  rateDiff: 'reasonRateDiff',
  allSame: 'reasonAllSame',
}

function reasonText(lang: Lang, reasons: GradeReason[]): string {
  return joinReasons(
    lang,
    reasons.map((r) =>
      r.code === 'rateDiff' ? t(lang, 'reasonRateDiff', { a: r.a, b: r.b }) : t(lang, REASON_KEY[r.code]),
    ),
  )
}

/** 每个视图能用的排序（pp差值 只在同图视图有意义） */
const SORTS: Record<ViewKey, Array<[SortKey, MsgKey]>> = {
  side: [['none', 'sortRank']],
  both: [
    ['none', 'sortDefault'],
    ['ppMaxDesc', 'sortPp'],
    ['dAsc', 'sortDAsc'],
    ['dDesc', 'sortDDesc'],
    ['absDesc', 'sortAbs'],
    ['gainDesc', 'sortGain'],
  ],
  onlyA: [
    ['none', 'sortPp'],
    ['gainDesc', 'sortGain'],
  ],
  onlyB: [
    ['none', 'sortPp'],
    ['gainDesc', 'sortGain'],
  ],
}

const PLATFORM_TEXT: Record<PlatformFilter, MsgKey> = {
  all: 'platformAll',
  same: 'platformSame',
  stable: 'platformStable',
  lazer: 'platformLazer',
}

/* ---------- 虚拟滚动 ---------- */

function useVisibleRange(total: number, rowH: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState({ start: 0, end: 30 })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const start = Math.max(0, Math.floor(el.scrollTop / rowH) - 4)
    const end = Math.min(total, start + Math.ceil(el.clientHeight / rowH) + 8)
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [total, rowH])

  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [update])

  return { ref, range, onScroll: update }
}

/* ---------- 单侧成绩块 ---------- */

function PlayCell({
  play,
  side,
  gain,
  oppName,
  ghost,
  lang,
}: {
  play?: Play
  side: 'a' | 'b'
  gain?: RowGain
  oppName?: string
  /** 对面有这张图、自己没有：只显示谱面信息，不显示成绩 */
  ghost?: Play
  lang: Lang
}) {
  const info = play ?? ghost
  if (!info) {
    return (
      <div className={`cell ${side} empty`}>
        <span className="muted">—</span>
      </div>
    )
  }
  const missing = !play
  return (
    <div className={`cell ${side}${missing ? ' ghost' : ''}`}>
      {info.beatmap.bgUrl && (
        <img className="bg" src={info.beatmap.bgUrl} alt="" loading="lazy" decoding="async" />
      )}
      <div className="shade" />
      <div className="cell-body">
        <div className="line1">
          {!missing && <span className="idx">#{info.index + 1}</span>}
          <span className="title" title={`${info.beatmap.artist} - ${info.beatmap.title}`}>
            {info.beatmap.title}
          </span>
          <span className="diff">[{info.beatmap.version}]</span>
        </div>
        <div className="line2">
          <span className="star">★{info.beatmap.star.toFixed(2)}</span>
          <span>{info.beatmap.bucket}</span>
          {!missing && <span className="mods">{modLabel(info)}</span>}
          {!missing && (
            <span className={`badge ${info.client}`} title={t(lang, 'clientEvidence', { evidence: info.clientEvidence })}>
              {clientLabel[info.client]}
            </span>
          )}
        </div>
      </div>
      {missing ? (
        <div className="score">
          <span className="nos">{t(lang, 'notPlayed')}</span>
        </div>
      ) : (
        <div className="score">
          <b>{info.pp.toFixed(2)}</b>
          <span className="pp">pp</span>
          <span className="acc">{(info.accuracy * 100).toFixed(2)}%</span>
          <span className="combo">{info.maxCombo}x</span>
          <span className="rank">{info.rank}</span>
          {gain && (
            <span
              className={`gainchip to-${gain.beneficiary}`}
              title={t(lang, 'gainTitle', {
                who: oppName ?? (gain.beneficiary === 'a' ? 'A' : 'B'),
                pp: gain.value.toFixed(2),
                rank: gain.position + 1,
                gain: gain.gain.toFixed(2),
              })}
            >
              +{gain.gain.toFixed(1)} →{gain.beneficiary.toUpperCase()}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function numOrNull(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** 本地校验错误用一个极简 code 表示，和网络错误一起走同一套翻译 */
const BOTH_REQUIRED = { code: 'bothRequired' } as const

function describeError(err: unknown, lang: Lang): string {
  if (err === BOTH_REQUIRED) return t(lang, 'errBothRequired')
  if (err instanceof ApiError) {
    if (err.code === 'notFound') return t(lang, 'errNotFound')
    if (err.code === 'rateLimited') return t(lang, 'errRateLimited')
    if (err.code === 'auth') return t(lang, 'errAuth')
    const base = t(lang, 'errHttp', { status: err.status })
    return err.detail ? `${base} — ${err.detail}` : base
  }
  return err instanceof Error ? err.message : String(err)
}

/* ---------- 主组件 ---------- */

export default function App() {
  const [inputA, setInputA] = useState('')
  const [inputB, setInputB] = useState('')
  const [a, setA] = useState<Player | null>(null)
  const [b, setB] = useState<Player | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [lang, setLangState] = useState<Lang>(readLang)
  const [bucket, setBucket] = useState<KeyBucket | null>(null)
  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [view, setView] = useState<ViewKey>('side')
  const [sort, setSort] = useState<SortKey>('none')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [topOpen, setTopOpen] = useState(true)
  const [recentA, setRecentA] = useState<string[]>(() => initRecent(RECENT_KEY_A))
  const [recentB, setRecentB] = useState<string[]>(() => initRecent(RECENT_KEY_B))
  // 链接里的设置只在首次加载后用一次（刷新时恢复现场）
  const pendingShare = useRef(decodeShare(window.location.search))

  const run = useCallback(async (refA: string, refB: string) => {
    const pa = parseUserInput(refA)
    const pb = parseUserInput(refB)
    if (!pa || !pb) {
      setError(BOTH_REQUIRED)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [resA, resB] = await Promise.all([fetchPlayer(pa), fetchPlayer(pb)])
      const share = pendingShare.current
      pendingShare.current = {}
      setA(resA)
      setB(resB)
      const wanted = share.keys
      const hasKeys =
        !!wanted && [resA, resB].some((p) => p.plays.some((x) => x.beatmap.bucket === wanted))
      setBucket(hasKeys ? wanted : defaultBucket(resA, resB))
      setPlatform(share.platform ?? 'all')
      setView(share.view ?? 'side')
      setSort(share.view === 'side' || !share.view ? 'none' : (share.sort ?? 'none'))
      setFilters(filtersFromShare(share, DEFAULT_FILTERS))
      setPicked(new Set())
      setRecentA(remember(RECENT_KEY_A, resA.name))
      setRecentB(remember(RECENT_KEY_B, resB.name))
    } catch (err) {
      setError(err)
      setA(null)
      setB(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const changeLang = useCallback((next: Lang) => {
    setLangState(next)
    saveLang(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = t(lang, 'title')
  }, [lang])

  // 首次进入：支持分享链接 ?a=&b=&keys=&platform=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pa = params.get('a')
    const pb = params.get('b')
    if (pa && pb) {
      setInputA(pa)
      setInputB(pb)
      void run(pa, pb)
    }
  }, [run])

  // 状态一变就把完整视图写回地址栏，复制即分享
  useEffect(() => {
    if (!a || !b) return
    const q = encodeShare({
      a: a.name,
      b: b.name,
      keys: bucket,
      platform,
      rate: filters.rate,
      starMin: filters.starMin,
      starMax: filters.starMax,
      year: filters.year,
      minAbsDelta: filters.minAbsDelta,
      view,
      sort,
    })
    window.history.replaceState(null, '', `?${q}`)
  }, [a, b, bucket, platform, filters, view, sort])

  // 该键数下、未加筛选器的原始成绩（用于统计筛选掉了多少条）
  const bucketPlaysA = useMemo(
    () => (a && bucket ? a.plays.filter((p) => p.beatmap.bucket === bucket) : []),
    [a, bucket],
  )
  const bucketPlaysB = useMemo(
    () => (b && bucket ? b.plays.filter((p) => p.beatmap.bucket === bucket) : []),
    [b, bucket],
  )

  const playsA = useMemo(
    () => (bucket ? applyFilters(select(bucketPlaysA, bucket, platform), filters) : []),
    [bucketPlaysA, bucket, platform, filters],
  )
  const playsB = useMemo(
    () => (bucket ? applyFilters(select(bucketPlaysB, bucket, platform), filters) : []),
    [bucketPlaysB, bucket, platform, filters],
  )

  const years = useMemo(() => availableYears([...bucketPlaysA, ...bucketPlaysB]), [bucketPlaysA, bucketPlaysB])

  const buildView = useCallback(
    (v: ViewKey): Pair[] => {
      let list = buildPairs(v, playsA, playsB)
      list = applyPlatformToPairs(list, platform, v)
      if (v === 'both') list = minAbsDelta(list, filters.minAbsDelta)
      return list
    },
    [playsA, playsB, platform, filters.minAbsDelta],
  )

  const pairs = useMemo(() => buildView(view), [buildView, view])

  // 增益一律按「该键数下、未经平台/年份筛选」的完整 BP 计算，否则会算错总分
  const rows = useMemo(
    () => sortRows(makeRows(pairs, bucketPlaysA, bucketPlaysB), sort),
    [pairs, bucketPlaysA, bucketPlaysB, sort],
  )

  const selectedRows = useMemo(() => rows.filter((r) => picked.has(r.key)), [rows, picked])

  const batch = useMemo(() => {
    const collect = (side: 'a' | 'b') => {
      const best = new Map<number, number>()
      for (const row of selectedRows) {
        for (const g of row.gains) {
          if (g.beneficiary !== side) continue
          const id = g.source.beatmap.id
          best.set(id, Math.max(best.get(id) ?? 0, g.value))
        }
      }
      return [...best.entries()].map(([mapId, pp]) => ({ mapId, pp }))
    }
    const itemsA = collect('a')
    const itemsB = collect('b')
    return {
      count: selectedRows.length,
      a: batchGain(bucketPlaysA, itemsA),
      b: batchGain(bucketPlaysB, itemsB),
      nA: itemsA.length,
      nB: itemsB.length,
    }
  }, [selectedRows, bucketPlaysA, bucketPlaysB])

  const togglePicked = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const counts = useMemo(
    () => ({
      side: buildView('side').length,
      both: buildView('both').length,
      onlyA: buildView('onlyA').length,
      onlyB: buildView('onlyB').length,
    }),
    [buildView],
  )

  const grades = useMemo(() => countGrades(pairs), [pairs])

  // 平台口径提示：被隐藏的跨平台 / 另一平台条数
  const crossTotal = useMemo(() => {
    if (!a || !b) return 0
    return buildPairs('both', playsA, playsB).filter((p) => p.a && p.b && p.a.client !== p.b.client).length
  }, [a, b, playsA, playsB])

  const droppedByPlatform = useMemo(() => {
    if (platform === 'all') return 0
    const keep = (list: Play[]) => list.filter((p) => platformMatch(p, platform)).length
    return bucketPlaysA.length + bucketPlaysB.length - keep(bucketPlaysA) - keep(bucketPlaysB)
  }, [bucketPlaysA, bucketPlaysB, platform])

  const filteredOut = bucketPlaysA.length + bucketPlaysB.length - playsA.length - playsB.length

  const { ref: scrollRef, range, onScroll } = useVisibleRange(rows.length, ROW_H)

  const bucketButtons = ALL_BUCKETS.filter((bk) => {
    const ca = a ? (countByBucket(a.plays).get(bk) ?? 0) : 0
    const cb = b ? (countByBucket(b.plays).get(bk) ?? 0) : 0
    return ca + cb > 0
  })

  const resetFilters = () => setFilters(DEFAULT_FILTERS)

  const canFold = Boolean(a && b && bucket)
  const showTop = !canFold || topOpen

  return (
    <div className="app">
      <header className="topbar">
        <div className="topline">
          <h1>{t(lang, 'title')}</h1>
          <div className="langswitch">
            {LANGS.map(([code, label]) => (
              <button
                key={code}
                className={`chip ${lang === code ? 'on' : ''}`}
                onClick={() => changeLang(code)}
                title={t(lang, 'langTitle')}
              >
                {label}
              </button>
            ))}
          </div>
          {canFold && !topOpen && a && b && bucket && (
            <span className="foldsummary">
              <b>{a.name}</b>
              <span className="vs">vs</span>
              <b>{b.name}</b>
              <span className="sep">·</span>
              {bucket}
              <span className="sep">·</span>
              {t(lang, PLATFORM_TEXT[platform])}
              {filters.rate !== 'all' && (
                <>
                  <span className="sep">·</span>
                  {filters.rate}
                </>
              )}
              {(filters.starMin !== null || filters.starMax !== null) && (
                <>
                  <span className="sep">·</span>★{filters.starMin ?? ''}~{filters.starMax ?? ''}
                </>
              )}
              {filters.year !== 'all' && (
                <>
                  <span className="sep">·</span>
                  {filters.year}
                </>
              )}
            </span>
          )}
        </div>

        {showTop && (
          <div className="inputs">
            <div className="side-input">
              <input
                value={inputA}
                onChange={(e) => setInputA(e.target.value)}
                placeholder={t(lang, 'placeholderA')}
                spellCheck={false}
              />
              {recentA.length > 0 && (
                <div className="recent">
                  {t(lang, 'recent')}
                  {recentA.map((name) => (
                    <button key={name} className="chip" onClick={() => setInputA(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="vs">vs</span>
            <div className="side-input">
              <input
                value={inputB}
                onChange={(e) => setInputB(e.target.value)}
                placeholder={t(lang, 'placeholderB')}
                spellCheck={false}
              />
              {recentB.length > 0 && (
                <div className="recent">
                  {t(lang, 'recent')}
                  {recentB.map((name) => (
                    <button key={name} className="chip" onClick={() => setInputB(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => void run(inputA, inputB)} disabled={loading}>
              {loading ? t(lang, 'loading') : t(lang, 'compare')}
            </button>
          </div>
        )}
        {error ? <div className="error">{describeError(error, lang)}</div> : null}
      </header>

      {a && b && bucket && (
        <>
          {topOpen && (
          <section className="context">
            <div className="row">
              <span className="label">{t(lang, 'keys')}</span>
              {bucketButtons.map((bk) => {
                const na = countByBucket(a.plays).get(bk) ?? 0
                const nb = countByBucket(b.plays).get(bk) ?? 0
                return (
                  <button key={bk} className={`chip ${bk === bucket ? 'on' : ''}`} onClick={() => setBucket(bk)}>
                    {bk} <span className="muted">A:{na} / B:{nb}</span>
                  </button>
                )
              })}
            </div>
            <div className="row">
              <span className="label">{t(lang, 'platform')}</span>
              {(['all', 'same', 'stable', 'lazer'] as PlatformFilter[]).map((value) => (
                <button
                  key={value}
                  className={`chip ${platform === value ? 'on' : ''}`}
                  onClick={() => setPlatform(value)}
                >
                  {t(lang, PLATFORM_TEXT[value])}
                </button>
              ))}
              {platform === 'same' && crossTotal > 0 && (
                <span className="muted">{t(lang, 'hiddenCross', { n: crossTotal })}</span>
              )}
              {platform === 'all' && crossTotal > 0 && (
                <span className="muted">{t(lang, 'crossNote', { n: crossTotal })}</span>
              )}
              {droppedByPlatform > 0 && (
                <span className="muted">{t(lang, 'hiddenOther', { n: droppedByPlatform })}</span>
              )}
            </div>
            <div className="cards">
              {[a, b].map((p) => {
                const n = countByBucket(p.plays).get(bucket) ?? 0
                const vpp = variantPp(p, bucket)
                return (
                  <div className="card" key={p.id}>
                    <div className="who">
                      <b>{p.name}</b>
                      <span className="muted">
                        #{p.globalRank ?? '—'} · {p.country}
                      </span>
                    </div>
                    <div className="numbers">
                      <span>{vpp ? `${vpp.toFixed(0)}pp (${bucket})` : t(lang, 'noVariant', { bucket })}</span>
                      <span className="muted">{t(lang, 'bpCount', { n })}</span>
                      <span className="muted">
                        {t(lang, 'totalPp', { pp: p.pp.toFixed(0), plays: p.playCount })}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
          )}

          {topOpen && (
          <section className="filters">
            <span className="label">rate mod</span>
            {(['all', 'NM', 'DT', 'HT'] as Array<'all' | RateMod>).map((value) => (
              <button
                key={value}
                className={`chip ${filters.rate === value ? 'on' : ''}`}
                onClick={() => setFilters((f) => ({ ...f, rate: value }))}
              >
                {value === 'all' ? t(lang, 'all') : value}
              </button>
            ))}

            <span className="label">{t(lang, 'stars')}</span>
            <input
              className="num"
              type="number"
              step="0.1"
              min="0"
              placeholder="min"
              value={filters.starMin ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, starMin: numOrNull(e.target.value) }))}
            />
            <span className="muted">~</span>
            <input
              className="num"
              type="number"
              step="0.1"
              min="0"
              placeholder="max"
              value={filters.starMax ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, starMax: numOrNull(e.target.value) }))}
            />

            <span className="label">{t(lang, 'year')}</span>
            <select
              value={String(filters.year)}
              onChange={(e) =>
                setFilters((f) => ({ ...f, year: e.target.value === 'all' ? 'all' : Number(e.target.value) }))
              }
            >
              <option value="all">{t(lang, 'all')}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            {view === 'both' && (
              <>
                <span className="label">{t(lang, 'deltaFilter')}</span>
                <input
                  className="num"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="0"
                  value={filters.minAbsDelta ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, minAbsDelta: numOrNull(e.target.value) }))}
                />
              </>
            )}

            <button className="chip" onClick={resetFilters}>
              {t(lang, 'reset')}
            </button>
            {filteredOut > 0 && <span className="muted">{t(lang, 'filteredOut', { n: filteredOut })}</span>}
          </section>
          )}

          <nav className="views">
            {(
              [
                ['side', 'viewSide', counts.side],
                ['both', 'viewBoth', counts.both],
                ['onlyA', 'viewOnlyA', counts.onlyA],
                ['onlyB', 'viewOnlyB', counts.onlyB],
              ] as Array<[ViewKey, MsgKey, number]>
            ).map(([key, textKey, n]) => (
              <button
                key={key}
                className={view === key ? 'on' : ''}
                onClick={() => {
                  setView(key)
                  setSort('none')
                }}
              >
                {t(lang, textKey, { n })}
              </button>
            ))}
            {canFold && (
              <button className="chip fold" onClick={() => setTopOpen((v) => !v)}>
                {topOpen ? t(lang, 'collapse') : t(lang, 'expand')}
              </button>
            )}
            {SORTS[view].length > 1 && (
              <select
                value={SORTS[view].some(([v]) => v === sort) ? sort : 'none'}
                onChange={(e) => {
                  setSort(e.target.value as SortKey)
                }}
              >
                {SORTS[view].map(([value, textKey]) => (
                  <option key={value} value={value}>
                    {t(lang, textKey)}
                  </option>
                ))}
              </select>
            )}
            {view === 'both' && (
              <span className="grades">
                <span className="grade gA" title={t(lang, 'gradeATip')}>
                  A {grades.A}
                </span>
                <span className="grade gB" title={t(lang, 'gradeBTip')}>
                  B {grades.B}
                </span>
              </span>
            )}
            {(view === 'onlyA' || view === 'onlyB') && platform === 'same' && (
              <span className="muted">{t(lang, 'sameNotApplicable')}</span>
            )}
            </nav>

          {batch.count > 0 && (
            <div className="batch">
              <span className="label">{t(lang, 'picked', { n: batch.count })}</span>
              {batch.nA > 0 && (
                <span className="batchnum to-a">
                  {t(lang, 'batchA', { v: `+${batch.a.toFixed(1)}` })}
                  <span className="muted">{t(lang, 'batchRows', { n: batch.nA })}</span>
                </span>
              )}
              {batch.nB > 0 && (
                <span className="batchnum to-b">
                  {t(lang, 'batchB', { v: `+${batch.b.toFixed(1)}` })}
                  <span className="muted">{t(lang, 'batchRows', { n: batch.nB })}</span>
                </span>
              )}
              <span className="muted">{t(lang, 'batchNote')}</span>
              <button className="chip" onClick={() => setPicked(new Set(rows.map((r) => r.key)))}>
                {t(lang, 'selectAll')}
              </button>
              <button className="chip" onClick={() => setPicked(new Set())}>
                {t(lang, 'clear')}
              </button>
            </div>
          )}

          <div className="table">
            {rows.length === 0 ? (
              <div className="empty-state">{t(lang, 'emptyState')}</div>
            ) : (
              <div className="scroll" ref={scrollRef} onScroll={onScroll}>
                <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
                  {rows.slice(range.start, range.end).map((row, i) => {
                    const idx = range.start + i
                    const pair = row.pair
                    const g = gradePair(pair, view === 'both')
                    const gainA = row.gains.find((x) => x.beneficiary === 'b')
                    const gainB = row.gains.find((x) => x.beneficiary === 'a')
                    return (
                      <div
                        key={row.key}
                        className={`rowpair ${picked.has(row.key) ? 'picked' : ''}`}
                        style={{ position: 'absolute', top: idx * ROW_H, height: ROW_H, left: 0, right: 0 }}
                      >
                        <label className="pick" title={t(lang, 'pickTitle')}>
                          <input type="checkbox" checked={picked.has(row.key)} onChange={() => togglePicked(row.key)} />
                        </label>
                        <PlayCell play={pair.a} side="a" gain={gainA} oppName={b?.name} ghost={pair.b} lang={lang} />
                        <div className="delta">
                          {pair.delta === undefined ? (
                            <span className="muted">—</span>
                          ) : (
                            <span className={pair.delta >= 0 ? 'up' : 'down'}>
                              {pair.delta >= 0 ? '+' : ''}
                              {pair.delta.toFixed(1)}
                            </span>
                          )}
                          {g && (
                            <span className={`grade g${g.grade}`} title={reasonText(lang, g.reasons)}>
                              {g.grade}
                            </span>
                          )}
                        </div>
                        <PlayCell play={pair.b} side="b" gain={gainB} oppName={a?.name} ghost={pair.a} lang={lang} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!a && !b && !loading && (
        <div className="hint">
          <p>{t(lang, 'hintTitle')}</p>
          <p className="muted">{t(lang, 'hintSub')}</p>
        </div>
      )}
    </div>
  )
}
