import type { Client, KeyBucket, RateMod } from '../types'

/** M0 实测：唯一可靠信号是 score.type；best_id 只作辅助校验。 */
export type ClientInput = {
  type?: string | null
  best_id?: number | null
}

export function detectClient(score: ClientInput): { client: Client; evidence: string } {
  const t = score.type ?? ''
  if (t === 'solo_score') return { client: 'lazer', evidence: 'type=solo_score' }
  if (t.startsWith('score_best_')) return { client: 'stable', evidence: `type=${t}` }
  if (typeof score.best_id === 'number') return { client: 'stable', evidence: 'best_id 存在' }
  if (t) return { client: 'unknown', evidence: `type=${t}` }
  return { client: 'unknown', evidence: '无 type 字段' }
}

export function detectRateMod(mods: readonly string[]): RateMod {
  if (mods.includes('DT') || mods.includes('NC')) return 'DT'
  if (mods.includes('HT') || mods.includes('DC')) return 'HT'
  return 'NM'
}

const KEY_BUCKETS: KeyBucket[] = ['4K', '5K', '6K', '7K', '8K', '9K', '10K+']

/** mania 的 cs 即键数；1K–3K 直接丢弃。 */
export function keyBucket(keys: number | null | undefined): KeyBucket | null {
  if (!keys || keys < 4) return null
  if (keys >= 10) return '10K+'
  return `${keys}K` as KeyBucket
}

export function bucketKeys(bucket: KeyBucket): number {
  return bucket === '10K+' ? 10 : Number(bucket.replace('K', ''))
}

export const ALL_BUCKETS = KEY_BUCKETS