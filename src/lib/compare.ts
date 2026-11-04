import { ALL_BUCKETS } from './client'
import type { Filters, Grade, KeyBucket, PlatformFilter, Player, Play, ViewKey } from '../types'

export type Pair = { a?: Play; b?: Play; delta?: number }

export const DEFAULT_FILTERS: Filters = {
  rate: 'all',
  starMin: null,
  starMax: null,
  year: 'all',
  minAbsDelta: null,
}

/** 当前玩家 top100 里每个键数各有几条。 */
export function countByBucket(plays: Play[]): Map<KeyBucket, number> {
  const m = new Map<KeyBucket, number>()
  for (const p of plays) {
    const b = p.beatmap.bucket
    if (b) m.set(b, (m.get(b) ?? 0) + 1)
  }
  return m
}

/** 默认键数：双方都有 BP 且 A 最多的那个；都不重叠时退化为 A 最多的。 */
export function defaultBucket(a: Player | null, b: Player | null): KeyBucket | null {
  if (!a || !b) return null
  const ca = countByBucket(a.plays)
  const cb = countByBucket(b.plays)
  let best: KeyBucket | null = null
  let bestScore = -1
  for (const bucket of ALL_BUCKETS) {
    const na = ca.get(bucket) ?? 0
    const nb = cb.get(bucket) ?? 0
    if (na > 0 && nb > 0 && na > bestScore) {
      best = bucket
      bestScore = na
    }
  }
  if (best) return best
  for (const bucket of ALL_BUCKETS) {
    const na = ca.get(bucket) ?? 0
    if (na > bestScore) {
      best = bucket
      bestScore = na
    }
  }
  return best
}

/** 单侧过滤：stable/lazer 是硬过滤；`same` 需要成对判断，见 applyPlatformToPairs。 */
export function platformMatch(p: Play, filter: PlatformFilter): boolean {
  if (filter === 'stable') return p.client === 'stable'
  if (filter === 'lazer') return p.client === 'lazer'
  return true
}

export function select(plays: Play[], bucket: KeyBucket, filter: PlatformFilter): Play[] {
  return plays.filter((p) => p.beatmap.bucket === bucket && platformMatch(p, filter))
}

export function yearOf(p: Play): number | null {
  const t = Date.parse(p.createdAt)
  if (Number.isNaN(t)) return null
  return new Date(t).getFullYear()
}

/** rate mod / 星数区间 / 年份（|Δpp| 是成对条件，见 minAbsDelta）。 */
export function applyFilters(plays: Play[], f: Filters): Play[] {
  return plays.filter((p) => {
    if (f.rate !== 'all' && p.rateMod !== f.rate) return false
    if (f.starMin !== null && p.beatmap.star < f.starMin) return false
    if (f.starMax !== null && p.beatmap.star > f.starMax) return false
    if (f.year !== 'all' && yearOf(p) !== f.year) return false
    return true
  })
}

export function availableYears(plays: Play[]): number[] {
  const set = new Set<number>()
  for (const p of plays) {
    const y = yearOf(p)
    if (y !== null) set.add(y)
  }
  return [...set].sort((x, y) => y - x)
}

export function buildPairs(view: ViewKey, a: Play[], b: Play[]): Pair[] {
  if (view === 'side') {
    const n = Math.max(a.length, b.length)
    return Array.from({ length: n }, (_, i) => ({
      a: a[i],
      b: b[i],
      delta: a[i] && b[i] && a[i].beatmap.id === b[i].beatmap.id ? a[i].pp - b[i].pp : undefined,
    }))
  }
  const mapA = new Map(a.map((p) => [p.beatmap.id, p]))
  const mapB = new Map(b.map((p) => [p.beatmap.id, p]))
  if (view === 'both') {
    // 同图视图 = 并集：只有一方有的图也列出来，缺席那一侧按 0pp 参与差值
    const rows: Pair[] = a.map((p) => {
      const other = mapB.get(p.beatmap.id)
      return { a: p, b: other, delta: p.pp - (other?.pp ?? 0) }
    })
    const seenA = new Set(a.map((p) => p.beatmap.id))
    for (const p of b) {
      if (!seenA.has(p.beatmap.id)) rows.push({ b: p, delta: -p.pp })
    }
    return rows
  }
  if (view === 'onlyA') return a.filter((p) => !mapB.has(p.beatmap.id)).map((p) => ({ a: p }))
  return b.filter((p) => !mapA.has(p.beatmap.id)).map((p) => ({ b: p }))
}

function ppOf(p: Pair): number {
  return p.a?.pp ?? p.b?.pp ?? 0
}

/**
 * 「相同平台」是成对条件：两侧同图、client 相同且已知才对局。
 * 只有一方有的图（同图并集里的单边行）没有对手侧，只要现存那一侧平台已知就保留。
 * 差集视图（仅A有/仅B有）本来就不构成对比，不裁剪。
 */
export function applyPlatformToPairs(pairs: Pair[], filter: PlatformFilter, view: ViewKey): Pair[] {
  if (filter !== 'same') return pairs
  if (view === 'onlyA' || view === 'onlyB') return pairs
  return pairs.filter((p) => {
    if (!p.a || !p.b) {
      const only = p.a ?? p.b
      return !!only && only.client !== 'unknown'
    }
    return p.a.client !== 'unknown' && p.a.client === p.b.client
  })
}

/** |Δpp| 下限，只对同图视图有意义。 */
export function minAbsDelta(pairs: Pair[], min: number | null): Pair[] {
  if (min === null) return pairs
  return pairs.filter((p) => p.delta !== undefined && Math.abs(p.delta) >= min)
}

export type SortKey = 'none' | 'dAsc' | 'dDesc' | 'absDesc' | 'gainDesc' | 'ppMaxDesc'

export function sortPairs(pairs: Pair[], sort: SortKey): Pair[] {
  if (sort === 'none' || sort === 'gainDesc' || sort === 'ppMaxDesc') return pairs
  const key = (p: Pair) =>
    sort === 'absDesc' ? -Math.abs(p.delta ?? 0) : sort === 'dDesc' ? -(p.delta ?? 0) : (p.delta ?? 0)
  return [...pairs].sort((x, y) => key(x) - key(y))
}

export type GradeReason =
  | { code: 'single' }
  | { code: 'diffMap' }
  | { code: 'unknownPlatform' }
  | { code: 'crossPlatform' }
  | { code: 'rateDiff'; a: string; b: string }
  | { code: 'allSame' }

export type GradeInfo = { grade: Grade; reasons: GradeReason[] }

/**
 * 三档可比性。原则：只标注，不做任何 pp 换算。
 * A 同图 + 同 rate mod + 同平台（均已知）→ 可直接比
 * B 上述有一项不同（含平台未知）→ 显示但不算分
 * C 不同图 → 仅并排
 *
 * 原因返回结构化 code，由界面按当前语言翻译（见 lib/i18n.ts）。
 */
export function gradePair(p: Pair, singleAsGrade = false): GradeInfo | null {
  if (!p.a || !p.b) {
    if (!singleAsGrade) return null
    return { grade: 'C', reasons: [{ code: 'single' }] }
  }
  if (p.a.beatmap.id !== p.b.beatmap.id) {
    return { grade: 'C', reasons: [{ code: 'diffMap' }] }
  }
  const reasons: GradeReason[] = []
  if (p.a.client === 'unknown' || p.b.client === 'unknown') {
    reasons.push({ code: 'unknownPlatform' })
  } else if (p.a.client !== p.b.client) {
    reasons.push({ code: 'crossPlatform' })
  }
  if (p.a.rateMod !== p.b.rateMod) {
    reasons.push({ code: 'rateDiff', a: p.a.rateMod, b: p.b.rateMod })
  }
  if (reasons.length === 0) {
    return { grade: 'A', reasons: [{ code: 'allSame' }] }
  }
  return { grade: 'B', reasons }
}

export function countGrades(pairs: Pair[]): Record<Grade, number> {
  const out: Record<Grade, number> = { A: 0, B: 0, C: 0 }
  for (const p of pairs) {
    const g = gradePair(p)
    if (g) out[g.grade] += 1
  }
  return out
}

/** `?variant=4k` 之类的官方分项 pp（只对 mania 提供）。 */
export function variantPp(player: Player, bucket: KeyBucket): number | null {
  const want = bucket === '10K+' ? null : bucket.replace('K', 'k')
  const v = player.variants.find((x) => (want ? x.variant === want : /^1\d+k$/.test(x.variant)))
  return v ? v.pp : null
}