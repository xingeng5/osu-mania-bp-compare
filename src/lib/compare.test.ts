import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toPlay, type RawScore } from '../api'
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
  select,
  sortPairs,
  variantPp,
  yearOf,
} from './compare'
import type { KeyBucket, Player, Play } from '../types'

const raw = JSON.parse(readFileSync('m0/best-10790649.json', 'utf8')) as RawScore[]
const plays = raw.map(toPlay)

const playerA: Player = {
  id: 1,
  name: 'AAA',
  country: 'CN',
  avatarUrl: '',
  pp: 14722.8,
  globalRank: 623,
  countryRank: 45,
  playCount: 30000,
  variants: [
    { variant: '4k', pp: 14722.8, globalRank: 623, countryRank: 45 },
    { variant: '7k', pp: 30416.7, globalRank: 1, countryRank: 1 },
  ],
  plays,
}

const playerB: Player = { ...playerA, id: 2, name: 'BBB' }

/** 只改动指定索引的 pp，用来构造 Δpp 与差集 */
function withPp(list: Play[], index: number, pp: number): Play[] {
  return list.map((p, i) => (i === index ? { ...p, pp, weightedPp: pp * Math.pow(0.95, i) } : p))
}

describe('countByBucket / defaultBucket', () => {
  it('统计每个键数的条数，1K–3K 不计入', () => {
    const counts = countByBucket(plays)
    let sum = 0
    for (const n of counts.values()) sum += n
    expect(sum).toBe(plays.length)
    expect([...counts.keys()].every((k) => (k as KeyBucket) !== null)).toBe(true)
  })

  it('优先选双方都有 BP 且 A 最多的键数', () => {
    const bucket = defaultBucket(playerA, playerB)
    expect(bucket).not.toBeNull()
    const ca = countByBucket(playerA.plays)
    const cb = countByBucket(playerB.plays)
    expect((ca.get(bucket!) ?? 0) > 0).toBe(true)
    expect((cb.get(bucket!) ?? 0) > 0).toBe(true)
    for (const [k, n] of ca) {
      const other = cb.get(k) ?? 0
      if (other > 0 && n > (ca.get(bucket!) ?? 0)) {
        throw new Error(`${k} 数量更多却没有被选为默认`)
      }
    }
  })

  it('没有玩家时返回 null', () => {
    expect(defaultBucket(null, playerB)).toBeNull()
  })
})

describe('select + platformMatch', () => {
  it('按键数过滤后每条都属于该键数', () => {
    const bucket = defaultBucket(playerA, playerB)!
    const picked = select(plays, bucket, 'all')
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.every((p) => p.beatmap.bucket === bucket)).toBe(true)
  })

  it('仅 STB / 仅 LZR 互斥且都不含 unknown', () => {
    const bucket = defaultBucket(playerA, playerB)!
    const stb = select(plays, bucket, 'stable')
    const lzr = select(plays, bucket, 'lazer')
    expect(stb.every((p) => p.client === 'stable')).toBe(true)
    expect(lzr.every((p) => p.client === 'lazer')).toBe(true)
    expect(stb.length + lzr.length).toBe(select(plays, bucket, 'all').length)
  })
})

describe('buildPairs', () => {
  const bucket = defaultBucket(playerA, playerB)!
  const a = select(plays, bucket, 'all')
  const b = withPp(a, 0, a[0].pp - 10)

  it('side：按排名并排，同图才给 Δpp', () => {
    const pairs = buildPairs('side', a, b)
    expect(pairs).toHaveLength(Math.max(a.length, b.length))
    expect(pairs[0].delta).toBeCloseTo(10, 5) // Δpp = A.pp − B.pp，B 降 10 → +10
  })

  it('both：并集，只有一方有的图也列出来，缺席侧按 0pp', () => {
    const pairs = buildPairs('both', a, b)
    expect(pairs).toHaveLength(a.length) // 两人图池相同 → 并集 = a
    expect(pairs.every((p) => p.a && p.b)).toBe(true)

    const shorter = b.slice(0, b.length - 3) // 对方少 3 张
    const union = buildPairs('both', a, shorter)
    expect(union).toHaveLength(a.length) // 并集不塌缩成交集
    const singles = union.filter((p) => !p.b)
    expect(singles).toHaveLength(3)
    expect(singles.every((p) => p.delta === p.a!.pp)).toBe(true) // 缺席侧 0pp → Δ = 自己 pp

    const flipped = buildPairs('both', shorter, a) // 换成自己缺 3 张
    const mine = flipped.filter((p) => !p.a)
    expect(mine).toHaveLength(3)
    expect(mine.every((p) => p.delta === -p.b!.pp)).toBe(true)
  })

  it('onlyA / onlyB：对方没有这张图才算差集', () => {
    const shorter = b.slice(0, b.length - 3)
    expect(buildPairs('onlyA', a, shorter)).toHaveLength(3)
    expect(buildPairs('onlyB', a, shorter)).toHaveLength(0)
    expect(buildPairs('onlyB', shorter, a)).toHaveLength(3)
  })

  it('差集只按 beatmap.id 判等，同曲不同难度算两张图', () => {
    const p = a[0]
    const otherDiff = { ...p, beatmap: { ...p.beatmap, id: p.beatmap.id + 999999 } }
    expect(buildPairs('onlyA', [p], [otherDiff])).toHaveLength(1)
    const sameSetOtherDiff = { ...p, beatmap: { ...p.beatmap, id: p.beatmap.id + 1, setId: p.beatmap.setId } }
    expect(buildPairs('onlyA', [p], [sameSetOtherDiff])).toHaveLength(1)
  })
})

describe('sortPairs', () => {
  const pairs = buildPairs('both', plays, withPp(plays, 0, plays[0].pp - 100))

  it('Δpp ↑ / ↓ 单调', () => {
    const asc = sortPairs(pairs, 'dAsc').map((p) => p.delta ?? 0)
    const desc = sortPairs(pairs, 'dDesc').map((p) => p.delta ?? 0)
    expect(asc).toEqual([...asc].sort((x, y) => x - y))
    expect(desc).toEqual([...desc].sort((x, y) => y - x))
  })

  it('|Δpp| ↓ 把差距最大的排最前', () => {
    const sorted = sortPairs(pairs, 'absDesc')
    const abs = sorted.map((p) => Math.abs(p.delta ?? 0))
    expect(abs).toEqual([...abs].sort((x, y) => y - x))
    expect(Math.abs(sorted[0].delta ?? 0)).toBeGreaterThan(90)
  })

  it('none 保持原顺序且不改原数组', () => {
    const before = [...pairs]
    expect(sortPairs(pairs, 'none')).toEqual(before)
    sortPairs(pairs, 'dAsc')
    expect(pairs).toEqual(before)
  })
})

describe('variantPp', () => {
  it('4K/7K 取官方分项，10K+ 用 1\\d+k 匹配', () => {
    expect(variantPp(playerA, '4K')).toBeCloseTo(14722.8, 1)
    expect(variantPp(playerA, '7K')).toBeCloseTo(30416.7, 1)
    expect(variantPp(playerA, '10K+')).toBeNull()
    expect(
      variantPp({ ...playerA, variants: [{ variant: '10k', pp: 1234, globalRank: 1, countryRank: 1 }] }, '10K+'),
    ).toBe(1234)
  })
})

describe('yearOf / availableYears / applyFilters', () => {
  it('yearOf 取自 createdAt，解析失败返回 null', () => {
    expect(yearOf(plays[0])).toBe(new Date(plays[0].createdAt).getFullYear())
    expect(yearOf({ ...plays[0], createdAt: 'not-a-date' })).toBeNull()
  })

  it('availableYears 降序且去重', () => {
    const years = availableYears(plays)
    expect(years).toEqual([...new Set(years)].sort((x, y) => y - x))
    expect(years.length).toBeGreaterThan(0)
  })

  it('rate mod 过滤只留指定项', () => {
    const dt = applyFilters(plays, { ...DEFAULT_FILTERS, rate: 'DT' })
    expect(dt.length).toBeGreaterThan(0)
    expect(dt.every((p) => p.rateMod === 'DT')).toBe(true)
  })

  it('星数区间闭区间生效', () => {
    const stars = plays.map((p) => p.beatmap.star).sort((x, y) => x - y)
    const lo = stars[3]
    const hi = stars[stars.length - 4]
    const picked = applyFilters(plays, { ...DEFAULT_FILTERS, starMin: lo, starMax: hi })
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.every((p) => p.beatmap.star >= lo && p.beatmap.star <= hi)).toBe(true)
  })

  it('年份过滤只留当年', () => {
    const y = yearOf(plays[0])!
    const picked = applyFilters(plays, { ...DEFAULT_FILTERS, year: y })
    expect(picked.every((p) => yearOf(p) === y)).toBe(true)
  })

  it('DEFAULT_FILTERS 不过滤任何东西', () => {
    expect(applyFilters(plays, DEFAULT_FILTERS)).toHaveLength(plays.length)
  })
})

describe('applyPlatformToPairs', () => {
  const both = buildPairs('both', plays, plays)

  it('same：只留两侧同平台且已知的对局', () => {
    const mixed = both.map((p, i) =>
      i === 0 && p.b
        ? { ...p, b: { ...p.b, client: p.b.client === 'stable' ? ('lazer' as const) : ('stable' as const) } }
        : p,
    )
    const kept = applyPlatformToPairs(mixed, 'same', 'both')
    expect(kept).toHaveLength(mixed.length - 1)
    expect(kept.every((p) => p.a!.client === p.b!.client && p.a!.client !== 'unknown')).toBe(true)
  })

  it('same：unknown 也算不可比', () => {
    const withUnknown = both.map((p, i) => (i === 1 && p.a ? { ...p, a: { ...p.a, client: 'unknown' as const } } : p))
    expect(applyPlatformToPairs(withUnknown, 'same', 'both')).toHaveLength(both.length - 1)
  })

  it('差集视图不做成对裁剪', () => {
    const onlyA = buildPairs('onlyA', plays, plays.slice(0, 10))
    expect(applyPlatformToPairs(onlyA, 'same', 'onlyA')).toHaveLength(onlyA.length)
  })

  it('same：只有一方有的行，现存侧平台已知就保留（用户 m00922 定案）', () => {
    const single = { a: plays[0] }
    expect(applyPlatformToPairs([single], 'same', 'both')).toHaveLength(1)
    expect(
      applyPlatformToPairs([{ a: { ...plays[0], client: 'unknown' as const } }], 'same', 'both'),
    ).toHaveLength(0)
    const shorter = plays.slice(0, plays.length - 3)
    const union = buildPairs('both', plays, shorter)
    expect(applyPlatformToPairs(union, 'same', 'both')).toHaveLength(union.length)
  })

  it('其它筛选值原样返回', () => {
    expect(applyPlatformToPairs(both, 'all', 'both')).toBe(both)
  })
})

describe('minAbsDelta', () => {
  const pairs = buildPairs('both', plays, withPp(plays, 0, plays[0].pp - 50))

  it('null 不过滤', () => {
    expect(minAbsDelta(pairs, null)).toBe(pairs)
  })

  it('只留 |Δpp| ≥ 阈值', () => {
    const kept = minAbsDelta(pairs, 20)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.every((p) => Math.abs(p.delta!) >= 20)).toBe(true)
    expect(kept.length).toBeLessThan(pairs.length)
  })
})

describe('gradePair / countGrades', () => {
  const base = buildPairs('both', plays, plays)[0]

  it('A：同图 + 同 rate mod + 同平台', () => {
    expect(gradePair(base)!.grade).toBe('A')
  })

  it('B：跨平台', () => {
    const other = base.b!.client === 'stable' ? 'lazer' : 'stable'
    const g = gradePair({ ...base, b: { ...base.b!, client: other as 'stable' | 'lazer' } })!
    expect(g.grade).toBe('B')
    expect(g.reasons.map((r) => r.code)).toContain('crossPlatform')
  })

  it('B：rate mod 不同', () => {
    const other = base.b!.rateMod === 'NM' ? 'DT' : 'NM'
    const g = gradePair({ ...base, b: { ...base.b!, rateMod: other as 'NM' | 'DT' } })!
    expect(g.grade).toBe('B')
    expect(g.reasons.map((r) => r.code)).toContain('rateDiff')
  })

  it('B：平台未知', () => {
    const g = gradePair({ ...base, b: { ...base.b!, client: 'unknown' as const } })!
    expect(g.grade).toBe('B')
    expect(g.reasons.map((r) => r.code)).toContain('unknownPlatform')
  })

  it('C：不同图', () => {
    const g = gradePair({ ...base, b: { ...base.b!, beatmap: { ...base.b!.beatmap, id: 1 } } })!
    expect(g.grade).toBe('C')
  })

  it('null：只有一侧', () => {
    expect(gradePair({ a: base.a })).toBeNull()
  })

  it('singleAsGrade：同图视图里一侧缺席也标 C，并说明按 0pp 计', () => {
    const g = gradePair({ a: base.a, delta: base.a!.pp }, true)!
    expect(g.grade).toBe('C')
    expect(g.reasons[0].code).toBe('single')
    expect(countGrades([{ a: base.a }]).C).toBe(0) // 计数仍只统计成对的
  })

  it('countGrades 只统计成对的', () => {
    const pairs = buildPairs('both', plays, plays).slice(0, 4)
    const counts = countGrades([...pairs, { a: plays[0] }])
    expect(counts.A).toBe(4)
    expect(counts.B + counts.C).toBe(0)
  })
})