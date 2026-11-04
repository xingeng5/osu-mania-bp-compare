import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toPlay, type RawScore } from '../api'
import { batchGain, gainIfGet, makeRows, rankOf, rowGains, rowGainSum, sortRows, weightedTotal } from './pp'
import type { Player, Play } from '../types'

const raw = JSON.parse(readFileSync('m0/best-10790649.json', 'utf8')) as RawScore[]
const plays = raw.map(toPlay)
const sevenK = plays.filter((p) => p.beatmap.keys === 7)

function fake(mapId: number, pp: number): Play {
  return { ...plays[0], beatmap: { ...plays[0].beatmap, id: mapId }, pp }
}

/** 独立实现的「重算」：先把要换掉的摘掉，再插进去，排序取前 100 加权。 */
function recompute(list: Play[], changes: Array<{ mapId: number; pp: number }>): number {
  const replaced = new Set(changes.map((c) => c.mapId))
  const values = list.filter((p) => !replaced.has(p.beatmap.id)).map((p) => p.pp)
  for (const c of changes) values.push(c.pp)
  values.sort((a, b) => b - a)
  let sum = 0
  for (let i = 0; i < Math.min(values.length, 100); i += 1) sum += values[i] * Math.pow(0.95, i)
  return sum
}

describe('weightedTotal', () => {
  it('等于按 pp 降序的 0.95^i 加权和', () => {
    const manual = [...sevenK]
      .sort((a, b) => b.pp - a.pp)
      .reduce((s, p, i) => s + p.pp * Math.pow(0.95, i), 0)
    expect(weightedTotal(sevenK)).toBeCloseTo(manual, 6)
  })

  it('顺序无关', () => {
    expect(weightedTotal([...sevenK].reverse())).toBeCloseTo(weightedTotal(sevenK), 6)
  })

  it('超过 100 条只算前 100', () => {
    const many = Array.from({ length: 130 }, (_, i) => fake(i, 100))
    let sum = 0
    for (let i = 0; i < 100; i += 1) sum += 100 * Math.pow(0.95, i)
    expect(weightedTotal(many)).toBeCloseTo(sum, 6)
  })
})

describe('rankOf', () => {
  it('比自己所有成绩都高时排第 0', () => {
    expect(rankOf(sevenK, 99999)).toBe(0)
  })

  it('比自己所有成绩都低时排到末尾', () => {
    expect(rankOf(sevenK, 0)).toBe(sevenK.length)
  })

  it('与重算一致', () => {
    const sorted = [...sevenK].sort((a, b) => b.pp - a.pp)
    const x = sorted[10].pp + 1
    expect(rankOf(sevenK, x)).toBe(10)
  })
})

describe('gainIfGet', () => {
  it('插入一条顶级成绩 = 重算差值', () => {
    const x = 9999
    const gained = gainIfGet(sevenK, 123456789, x)
    expect(gained).toBeCloseTo(recompute(sevenK, [{ mapId: 123456789, pp: x }]) - recompute(sevenK, []), 6)
    expect(gained).toBeGreaterThan(0)
  })

  it('同图已有较低成绩时按替换计算（旧的不再重复计）', () => {
    const target = [...sevenK].sort((a, b) => b.pp - a.pp)[5]
    const x = target.pp + 50
    const gained = gainIfGet(sevenK, target.beatmap.id, x)
    expect(gained).toBeCloseTo(recompute(sevenK, [{ mapId: target.beatmap.id, pp: x }]) - recompute(sevenK, []), 6)
  })

  it('已经比它强则增益为 0', () => {
    const target = [...sevenK].sort((a, b) => b.pp - a.pp)[5]
    expect(gainIfGet(sevenK, target.beatmap.id, target.pp - 10)).toBe(0)
  })

  it('满 100 条时把第 100 名挤出去，增益小于裸加权值', () => {
    const full = Array.from({ length: 100 }, (_, i) => fake(i, 1000 - i))
    const gained = gainIfGet(full, 999999, 5000)
    expect(gained).toBeCloseTo(recompute(full, [{ mapId: 999999, pp: 5000 }]) - recompute(full, []), 6)
    // 插到第 1 位会把所有人往下压一位，增益明显小于面值 5000
    expect(gained).toBeLessThan(5000)
  })
})

describe('batchGain', () => {
  it('等于一次性重算的差值', () => {
    const items = [
      { mapId: 9000001, pp: 1200 },
      { mapId: 9000002, pp: 1100 },
      { mapId: 9000003, pp: 999 },
    ]
    expect(batchGain(sevenK, items)).toBeCloseTo(recompute(sevenK, items) - recompute(sevenK, []), 6)
  })

  it('不高于逐条相加（位移会互相挤压）', () => {
    const items = [
      { mapId: 9000001, pp: 1200 },
      { mapId: 9000002, pp: 1100 },
      { mapId: 9000003, pp: 999 },
    ]
    const sum = items.reduce((s, it) => s + gainIfGet(sevenK, it.mapId, it.pp), 0)
    expect(batchGain(sevenK, items)).toBeLessThanOrEqual(sum + 1e-9)
  })

  it('空选集为 0', () => {
    expect(batchGain(sevenK, [])).toBe(0)
  })

  it('选中已经更强的同图成绩不计入', () => {
    const target = [...sevenK].sort((a, b) => b.pp - a.pp)[3]
    expect(batchGain(sevenK, [{ mapId: target.beatmap.id, pp: target.pp - 1 }])).toBe(0)
  })
})

describe('rowGains', () => {
  const me = [...sevenK].sort((a, b) => b.pp - a.pp)
  const opp = me.map((p, i) => ({ ...p, pp: p.pp - 200 }))
  /** 只有第 index 张图比 me 低 delta 的列表 */
  const weaker = (index: number, delta: number) =>
    me.map((p, i) => (i === index ? { ...p, pp: p.pp - delta } : p))

  it('同图我更高 → 对手补这条的增益', () => {
    const gains = rowGains({ a: me[0], b: opp[0], delta: 200 }, me, opp)
    expect(gains).toHaveLength(1)
    expect(gains[0].beneficiary).toBe('b')
    expect(gains[0].value).toBe(me[0].pp)
    expect(gains[0].gain).toBeCloseTo(
      recompute(opp, [{ mapId: me[0].beatmap.id, pp: me[0].pp }]) - recompute(opp, []),
      6,
    )
  })

  it('对手更高 → 增益归我', () => {
    const aList = weaker(0, 300)
    const gains = rowGains({ a: aList[0], b: me[0], delta: -300 }, aList, me)
    expect(gains).toHaveLength(1)
    expect(gains[0].beneficiary).toBe('a')
    expect(gains[0].gain).toBeGreaterThan(0)
  })

  it('一人没有时视作 0pp，增益归缺的那一方', () => {
    const gains = rowGains({ a: me[0] }, me, opp)
    expect(gains).toHaveLength(1)
    expect(gains[0].beneficiary).toBe('b')
    expect(gains[0].gain).toBeGreaterThan(0)
  })

  it('两侧一样则没有增益', () => {
    expect(rowGains({ a: me[0], b: me[0], delta: 0 }, me, me)).toHaveLength(0)
  })

  it('两侧是两张不同的图时可以有两条（各自补给对方）', () => {
    const gains = rowGains({ a: me[0], b: opp[5] }, me, opp)
    expect(gains.length).toBeGreaterThanOrEqual(1)
  })
})

describe('makeRows / sortRows', () => {
  const me = [...sevenK].sort((a, b) => b.pp - a.pp).slice(0, 10)
  const opp = me.map((p, i) => ({ ...p, pp: p.pp - i * 10 }))
  const pairs = me.map((p, i) => ({ a: p, b: opp[i], delta: p.pp - opp[i].pp }))

  it('每行带 key 与增益', () => {
    const rows = makeRows(pairs, me, opp)
    expect(rows).toHaveLength(10)
    expect(new Set(rows.map((r) => r.key)).size).toBe(10)
    expect(rows.every((r) => r.gains.length <= 2)).toBe(true)
  })

  it('gainDesc 按增益总量降序', () => {
    const rows = sortRows(makeRows(pairs, me, opp), 'gainDesc')
    const sums = rows.map(rowGainSum)
    for (let i = 1; i < sums.length; i += 1) expect(sums[i - 1]).toBeGreaterThanOrEqual(sums[i])
  })

  it('ppMaxDesc 按两侧较高 pp 降序（含单边行）', () => {
    const rows = makeRows(
      [...pairs, { a: fake(999, 1234.5) }],
      me,
      opp,
    )
    const sorted = sortRows(rows, 'ppMaxDesc')
    const top = sorted.map((r) => Math.max(r.pair.a?.pp ?? -1, r.pair.b?.pp ?? -1))
    for (let i = 1; i < top.length; i += 1) expect(top[i - 1]).toBeGreaterThanOrEqual(top[i])
  })

  it('none 不改变顺序', () => {
    const rows = makeRows(pairs, me, opp)
    expect(sortRows(rows, 'none')).toBe(rows)
  })
})