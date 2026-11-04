import type { Play } from '../types'
import type { Pair, SortKey } from './compare'

/** osu! 的 pp 加总：按 pp 降序，第 i 条权重 0.95^i，只取前 100 条。 */
export const TOP_N = 100
export const DECAY = 0.95

function totalOf(values: number[], cap = TOP_N): number {
  const sorted = [...values].sort((x, y) => y - x)
  let sum = 0
  const n = Math.min(sorted.length, cap)
  for (let i = 0; i < n; i += 1) sum += sorted[i] * Math.pow(DECAY, i)
  return sum
}

/** 玩家（某个键数下）的加权总 pp。 */
export function weightedTotal(plays: Play[], cap = TOP_N): number {
  return totalOf(
    plays.map((p) => p.pp),
    cap,
  )
}

/** 这条成绩如果算进去，会排在第几位（0 起）。比自己所有成绩都低时返回 length。 */
export function rankOf(plays: Play[], pp: number, cap = TOP_N): number {
  const sorted = [...plays].sort((x, y) => y.pp - x.pp)
  const k = sorted.findIndex((p) => p.pp < pp)
  const at = k === -1 ? sorted.length : k
  return Math.min(at, cap)
}

/**
 * 「若我把这张图的成绩打到 pp」→ 加权总 pp 会涨多少。
 * 同一张图已有成绩时是替换（旧的先摘掉）；已经比它高则返回 0。
 */
export function gainIfGet(plays: Play[], mapId: number, pp: number, cap = TOP_N): number {
  const base = totalOf(
    plays.map((p) => p.pp),
    cap,
  )
  const own = plays.find((p) => p.beatmap.id === mapId)
  if (own && own.pp >= pp) return 0
  const values = plays.filter((p) => p.beatmap.id !== mapId).map((p) => p.pp)
  values.push(pp)
  return totalOf(values, cap) - base
}

/**
 * 批量：「这些图同时都打到这些成绩」→ 总 pp 涨多少。
 * 必须一起重算：逐条相加会重复计算被挤下去的位移损失，结果偏高。
 */
export function batchGain(
  plays: Play[],
  items: Array<{ mapId: number; pp: number }>,
  cap = TOP_N,
): number {
  if (items.length === 0) return 0
  const base = totalOf(
    plays.map((p) => p.pp),
    cap,
  )
  const replaced = new Set(items.map((it) => it.mapId))
  const values = plays.filter((p) => !replaced.has(p.beatmap.id)).map((p) => p.pp)
  for (const it of items) {
    const own = plays.find((p) => p.beatmap.id === it.mapId)
    // 已经更强时保持原值，不能把它漏掉，否则总 pp 会凭空下降
    values.push(own ? Math.max(own.pp, it.pp) : it.pp)
  }
  return totalOf(values, cap) - base
}

/** 一行里，谁的这条成绩「补到对面」能涨多少。 */
export type RowGain = {
  /** 受益方：这条成绩属于对面，补给他 */ beneficiary: 'a' | 'b'
  /** 用来估算的 pp（取自成绩更高的那一侧） */ value: number
  /** 这条成绩的出处（界面上把标签挂在它自己那格里） */ source: Play
  /** 补进去会落在受益方的第几位（0 起，100 表示打不进 bp） */ position: number
  /** 加权总 pp 的增量 */ gain: number
}

/** 一行最多两种可能（两侧是两张不同的图时，各自都能补给对方）。 */
export function rowGains(pair: Pair, aPlays: Play[], bPlays: Play[]): RowGain[] {
  const out: RowGain[] = []
  const push = (beneficiary: 'a' | 'b', source: Play) => {
    const target = beneficiary === 'a' ? aPlays : bPlays
    const gain = gainIfGet(target, source.beatmap.id, source.pp)
    if (gain <= 0) return
    out.push({ beneficiary, value: source.pp, source, position: rankOf(target, source.pp), gain })
  }
  if (pair.a && pair.b) {
    if (pair.a.pp > pair.b.pp) push('b', pair.a)
    else if (pair.b.pp > pair.a.pp) push('a', pair.b)
  } else if (pair.a) {
    push('b', pair.a)
  } else if (pair.b) {
    push('a', pair.b)
  }
  return out
}

export function rowKey(pair: Pair): string {
  return `${pair.a?.beatmap.id ?? 'x'}:${pair.b?.beatmap.id ?? 'x'}`
}

export function pairPp(p: Pair, side: 'a' | 'b'): number | null {
  const play = side === 'a' ? p.a : p.b
  return play ? play.pp : null
}

export type Row = { key: string; pair: Pair; gains: RowGain[] }

export function makeRows(pairs: Pair[], aPlays: Play[], bPlays: Play[]): Row[] {
  return pairs.map((pair) => ({ key: rowKey(pair), pair, gains: rowGains(pair, aPlays, bPlays) }))
}

/** 增益总量：两侧都成立时相加，用于「这行有多少东西可补」的排序。 */
export function rowGainSum(row: Row): number {
  return row.gains.reduce((s, g) => s + g.gain, 0)
}

export function sortRows(rows: Row[], sort: SortKey): Row[] {
  if (sort === 'none') return rows
  const byDelta = (r: Row) => r.pair.delta ?? 0
  const key = (r: Row): number => {
    switch (sort) {
      case 'dAsc':
        return byDelta(r)
      case 'dDesc':
        return -byDelta(r)
      case 'absDesc':
        return -Math.abs(byDelta(r))
      case 'gainDesc':
        return -rowGainSum(r)
      case 'ppMaxDesc': {
        const a = r.pair.a?.pp ?? -1
        const b = r.pair.b?.pp ?? -1
        return -Math.max(a, b)
      }
      default:
        return 0
    }
  }
  return [...rows].sort((x, y) => key(x) - key(y))
}