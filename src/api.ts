import {
  detectClient,
  detectRateMod,
  keyBucket,
} from './lib/client'
import type { Play, Player, VariantStats } from './types'

type RawMod = string | { acronym?: string }

export type RawScore = {
  id?: number
  type?: string | null
  best_id?: number | null
  pp?: number | null
  accuracy?: number | null
  max_combo?: number | null
  rank?: string | null
  score?: number | null
  created_at?: string | null
  mods?: RawMod[]
  weight?: { percentage?: number; pp?: number } | null
  statistics?: Record<string, number> | null
  beatmap?: RawBeatmap | null
  beatmapset?: RawBeatmapset | null
}

type RawBeatmap = {
  id?: number
  beatmapset_id?: number
  cs?: number | null
  difficulty_rating?: number | null
  version?: string | null
  bpm?: number | null
  total_length?: number | null
  hit_length?: number | null
  status?: string | null
  mode?: string | null
}

type RawCovers = Record<string, string | undefined>

type RawBeatmapset = {
  id?: number
  title?: string | null
  artist?: string | null
  creator?: string | null
  status?: string | null
  covers?: RawCovers | null
}

type RawUser = {
  id: number
  username: string
  avatar_url?: string
  country?: { code?: string } | null
  country_code?: string | null
  playmode?: string | null
  statistics?: {
    pp?: number | null
    global_rank?: number | null
    country_rank?: number | null
    play_count?: number | null
    variants?: Array<{
      mode?: string
      variant?: string
      pp?: number | null
      global_rank?: number | null
      country_rank?: number | null
    }> | null
  } | null
}

const modName = (m: RawMod): string => (typeof m === 'string' ? m : (m.acronym ?? ''))

export function toPlay(raw: RawScore, index: number): Play {
  const mods = (raw.mods ?? []).map(modName).filter(Boolean)
  const rateMod = detectRateMod(mods)
  const { client, evidence } = detectClient({ type: raw.type, best_id: raw.best_id })
  const bm = raw.beatmap ?? {}
  const set = raw.beatmapset ?? {}
  const st = raw.statistics ?? {}
  const keys = typeof bm.cs === 'number' ? bm.cs : null
  const pp = raw.pp ?? 0

  return {
    index,
    pp,
    weightedPp: pp * Math.pow(0.95, index),
    accuracy: raw.accuracy ?? 0,
    maxCombo: raw.max_combo ?? 0,
    rank: raw.rank ?? '-',
    rateMod,
    mods,
    extraMods: mods.filter((m) => m !== 'DT' && m !== 'NC' && m !== 'HT' && m !== 'DC'),
    client,
    clientEvidence: evidence,
    createdAt: raw.created_at ?? '',
    hits: {
      max: st.count_geki ?? 0,
      h300: st.count_300 ?? 0,
      h200: st.count_100 ?? 0,
      h100: st.count_50 ?? 0,
      h50: st.count_katu ?? 0,
      miss: st.count_miss ?? 0,
    },
    beatmap: {
      id: bm.id ?? 0,
      setId: set.id ?? bm.beatmapset_id ?? 0,
      keys: keys ?? 0,
      bucket: keyBucket(keys),
      star: bm.difficulty_rating ?? 0,
      title: set.title ?? '未知曲目',
      artist: set.artist ?? '',
      creator: set.creator ?? '',
      version: bm.version ?? '',
      bpm: bm.bpm ?? 0,
      lengthSec: bm.total_length ?? bm.hit_length ?? 0,
      status: set.status ?? bm.status ?? '',
      bgUrl: set.covers?.cover ?? '',
      thumbUrl: set.covers?.list ?? set.covers?.cover ?? '',
    },
  }
}

function toVariants(raw: RawUser): VariantStats[] {
  return (raw.statistics?.variants ?? [])
    .filter((v) => (v.mode ?? 'mania') === 'mania' && v.variant)
    .map((v) => ({
      variant: v.variant as string,
      pp: v.pp ?? 0,
      globalRank: v.global_rank ?? null,
      countryRank: v.country_rank ?? null,
    }))
}

export function toPlayer(raw: RawUser, scores: RawScore[]): Player {
  return {
    id: raw.id,
    name: raw.username,
    country: raw.country?.code ?? raw.country_code ?? '',
    avatarUrl: raw.avatar_url ?? '',
    pp: raw.statistics?.pp ?? 0,
    globalRank: raw.statistics?.global_rank ?? null,
    countryRank: raw.statistics?.country_rank ?? null,
    playCount: raw.statistics?.play_count ?? 0,
    variants: toVariants(raw),
    plays: scores.map(toPlay),
  }
}

const BASE = '/api/osu'

/** 网络层错误带一个 code，界面按当前语言翻译（见 lib/i18n.ts）。 */
export type ApiErrorCode = 'notFound' | 'rateLimited' | 'auth' | 'http'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly detail: string

  constructor(code: ApiErrorCode, status: number, detail: string) {
    super(detail || code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

function errorOf(status: number, body: string): ApiError {
  let detail = ''
  try {
    const j = JSON.parse(body) as { error?: string; message?: string }
    detail = j.error ?? j.message ?? ''
  } catch {
    /* 非 JSON（例如代理返回的纯文本），保留原文片段 */
    detail = body.trim().slice(0, 200)
  }
  if (status === 404) return new ApiError('notFound', status, detail)
  if (status === 429) return new ApiError('rateLimited', status, detail)
  if (status === 401 || status === 403) return new ApiError('auth', status, detail)
  return new ApiError('http', status, detail)
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (!res.ok) throw errorOf(res.status, text)
  return JSON.parse(text) as T
}

export async function fetchPlayer(ref: string): Promise<Player> {
  const user = await getJson<RawUser>(`/users/${encodeURIComponent(ref)}/mania`)
  const scores = await getJson<RawScore[]>(`/users/${user.id}/scores/best?mode=mania&limit=100`)
  return toPlayer(user, Array.isArray(scores) ? scores : [])
}

/** 接受：数字 ID / 用户名 / osu 主页链接（含 /users/{id} 与 /users/{name}）。 */
export function parseUserInput(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return s
  const url = s.match(/osu\.ppy\.sh\/users\/([^/?#\s]+)/i)
  if (url) return decodeURIComponent(url[1])
  if (/^[\w.\-\[\] ]{2,20}$/.test(s)) return s
  return null
}