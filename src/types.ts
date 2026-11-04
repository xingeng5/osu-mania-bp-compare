export type RateMod = 'NM' | 'DT' | 'HT'
export type Client = 'stable' | 'lazer' | 'unknown'
export type KeyBucket = '4K' | '5K' | '6K' | '7K' | '8K' | '9K' | '10K+'

export type Play = {
  index: number
  pp: number
  weightedPp: number
  accuracy: number
  maxCombo: number
  rank: string
  rateMod: RateMod
  mods: string[]
  extraMods: string[]
  client: Client
  clientEvidence: string
  createdAt: string
  hits: { max: number; h300: number; h200: number; h100: number; h50: number; miss: number }
  beatmap: {
    id: number
    setId: number
    keys: number
    bucket: KeyBucket | null
    star: number
    title: string
    artist: string
    creator: string
    version: string
    bpm: number
    lengthSec: number
    status: string
    bgUrl: string
    thumbUrl: string
  }
}

export type VariantStats = {
  variant: string
  pp: number
  globalRank: number | null
  countryRank: number | null
}

export type Player = {
  id: number
  name: string
  country: string
  avatarUrl: string
  pp: number
  globalRank: number | null
  countryRank: number | null
  playCount: number
  variants: VariantStats[]
  plays: Play[]
}

export type CompareState = {
  keys: KeyBucket
  platform: PlatformFilter
  view: ViewKey
}

export type PlatformFilter = 'all' | 'same' | 'stable' | 'lazer'
export type ViewKey = 'side' | 'both' | 'onlyA' | 'onlyB'

/** 三档可比性：A 可计入比分 / B 显示但不算 / C 不同图只并排 */
export type Grade = 'A' | 'B' | 'C'

export type Filters = {
  rate: 'all' | RateMod
  starMin: number | null
  starMax: number | null
  year: 'all' | number
  /** 仅同图视图生效：|Δpp| 下限 */
  minAbsDelta: number | null
}