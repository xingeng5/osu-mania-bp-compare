import { ALL_BUCKETS } from './client'
import type { Filters, KeyBucket, PlatformFilter, RateMod, ViewKey } from '../types'
import type { SortKey } from './compare'

export type ShareState = {
  a: string
  b: string
  keys: KeyBucket | null
  platform: PlatformFilter
  rate: 'all' | RateMod
  starMin: number | null
  starMax: number | null
  year: 'all' | number
  minAbsDelta: number | null
  view: ViewKey
  sort: SortKey
}

const PLATFORMS: PlatformFilter[] = ['all', 'same', 'stable', 'lazer']
const VIEWS: ViewKey[] = ['side', 'both', 'onlyA', 'onlyB']
const SORTS: SortKey[] = ['none', 'dAsc', 'dDesc', 'absDesc', 'gainDesc', 'ppMaxDesc']
const RATES: Array<'all' | RateMod> = ['all', 'NM', 'DT', 'HT']

/** 只把非默认值写进 URL，链接短一些。 */
export function encodeShare(s: ShareState): string {
  const q = new URLSearchParams()
  q.set('a', s.a)
  q.set('b', s.b)
  if (s.keys) q.set('keys', s.keys)
  if (s.platform !== 'all') q.set('platform', s.platform)
  if (s.rate !== 'all') q.set('rate', s.rate)
  if (s.starMin !== null) q.set('starMin', String(s.starMin))
  if (s.starMax !== null) q.set('starMax', String(s.starMax))
  if (s.year !== 'all') q.set('year', String(s.year))
  if (s.minAbsDelta !== null) q.set('da', String(s.minAbsDelta))
  if (s.view !== 'side') q.set('view', s.view)
  if (s.sort !== 'none') q.set('sort', s.sort)
  return q.toString()
}

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 解出来的一律是「可用的值」；非法值当作没写。 */
export function decodeShare(search: string): Partial<ShareState> {
  const q = new URLSearchParams(search)
  const out: Partial<ShareState> = {}
  const a = q.get('a')
  const b = q.get('b')
  if (a) out.a = a
  if (b) out.b = b

  const keys = q.get('keys')
  if (keys && (ALL_BUCKETS as string[]).includes(keys)) out.keys = keys as KeyBucket

  const platform = q.get('platform')
  if (platform && (PLATFORMS as string[]).includes(platform)) out.platform = platform as PlatformFilter

  const rate = q.get('rate')
  if (rate && (RATES as string[]).includes(rate)) out.rate = rate as 'all' | RateMod

  const view = q.get('view')
  if (view && (VIEWS as string[]).includes(view)) out.view = view as ViewKey

  const sort = q.get('sort')
  if (sort && (SORTS as string[]).includes(sort)) out.sort = sort as SortKey

  const starMin = num(q.get('starMin'))
  if (starMin !== null && starMin >= 0) out.starMin = starMin
  const starMax = num(q.get('starMax'))
  if (starMax !== null && starMax >= 0) out.starMax = starMax
  const da = num(q.get('da'))
  if (da !== null && da >= 0) out.minAbsDelta = da

  const year = q.get('year')
  if (year === 'all') out.year = 'all'
  else {
    const y = num(year)
    if (y !== null && y > 2000 && y < 2100 && Number.isInteger(y)) out.year = y
  }
  return out
}

/** 分享态 + 默认值 → 完整的 Filters（缺项用默认）。 */
export function filtersFromShare(s: Partial<ShareState>, defaults: Filters): Filters {
  return {
    rate: s.rate ?? defaults.rate,
    starMin: s.starMin ?? defaults.starMin,
    starMax: s.starMax ?? defaults.starMax,
    year: s.year ?? defaults.year,
    minAbsDelta: s.minAbsDelta ?? defaults.minAbsDelta,
  }
}