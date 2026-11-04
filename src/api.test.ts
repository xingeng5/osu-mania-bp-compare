import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toPlay } from './api'
import { detectClient, detectRateMod, keyBucket } from './lib/client'
import type { RawScore } from './api'

const raw = JSON.parse(readFileSync('m0/best-10790649.json', 'utf8')) as RawScore[]

describe('detectClient（只信 type）', () => {
  it('solo_score → lazer', () => {
    expect(detectClient({ type: 'solo_score' }).client).toBe('lazer')
  })
  it('score_best_mania → stable', () => {
    expect(detectClient({ type: 'score_best_mania' }).client).toBe('stable')
  })
  it('未知 type → unknown', () => {
    expect(detectClient({ type: 'whatever' }).client).toBe('unknown')
    expect(detectClient({}).client).toBe('unknown')
  })
})

describe('detectRateMod / keyBucket', () => {
  it('DT/NC → DT，HT/DC → HT，其余 NM', () => {
    expect(detectRateMod(['HD', 'DT'])).toBe('DT')
    expect(detectRateMod(['NC'])).toBe('DT')
    expect(detectRateMod(['HT'])).toBe('HT')
    expect(detectRateMod(['DC'])).toBe('HT')
    expect(detectRateMod(['HD', 'MR'])).toBe('NM')
  })
  it('1K–3K 丢弃，10K 以上归 10K+', () => {
    expect(keyBucket(3)).toBeNull()
    expect(keyBucket(null)).toBeNull()
    expect(keyBucket(4)).toBe('4K')
    expect(keyBucket(7)).toBe('7K')
    expect(keyBucket(10)).toBe('10K+')
    expect(keyBucket(12)).toBe('10K+')
  })
})

describe('toPlay（真实 best JSON）', () => {
  const plays = raw.map(toPlay)

  it('100 条全部归一化', () => {
    expect(plays).toHaveLength(100)
    expect(plays[0].index).toBe(0)
    expect(plays[0].weightedPp).toBeCloseTo(plays[0].pp, 5)
    expect(plays[1].weightedPp).toBeCloseTo(plays[1].pp * 0.95, 5)
  })

  it('按权重降序：pp 不递增是正常的，但加权 pp 必须单调不增', () => {
    for (let i = 1; i < plays.length; i++) {
      expect(plays[i].weightedPp).toBeLessThanOrEqual(plays[i - 1].weightedPp + 1e-9)
    }
  })

  it('每条都有键数与背景图（mania 的 cs 就是键数）', () => {
    for (const p of plays) {
      expect(p.beatmap.keys).toBeGreaterThanOrEqual(4)
      expect(p.beatmap.bucket).not.toBeNull()
      expect(p.beatmap.id).toBeGreaterThan(0)
    }
    const withBg = plays.filter((p) => p.beatmap.bgUrl).length
    expect(withBg).toBe(100)
  })

  it('客户端判定落在 stable/lazer 两档，无 unknown', () => {
    const kinds = new Set(plays.map((p) => p.client))
    expect(kinds.has('unknown')).toBe(false)
    expect([...kinds].sort()).toEqual(['lazer', 'stable'])
  })
})