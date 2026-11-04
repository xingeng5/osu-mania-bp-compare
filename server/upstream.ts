/**
 * osu! API v2 上游封装：client_credentials 换 token、限流退避。
 * 被两个宿主共用：vite dev 插件（server/osuProxy.ts）与便携版服务器（server/portable.ts）。
 *
 * 刻意不缓存接口响应：这个工具使用频率低、数据要新鲜，每次点「对比」都重新取。
 * token 仍然缓存（它是凭据换来的，24 小时有效，不缓存等于每次请求都重新认证）。
 *
 * 约定：密钥只在此文件的 Node 侧出现，永远不进前端 bundle。
 */

const API_ORIGIN = 'https://osu.ppy.sh'
const USER_AGENT = 'mania-bp-compare/0.1 (local web app)'
const TOKEN_SKEW_S = 60
const TOKEN_TTL_MS = 86400_000

export type Creds = { clientId?: string; clientSecret?: string }
export type UpstreamResult = { status: number; body: string }

export class MissingCredsError extends Error {
  constructor(message = '缺少 OSU_CLIENT_ID / OSU_CLIENT_SECRET') {
    super(message)
    this.name = 'MissingCredsError'
  }
}

type Token = { value: string; expiresAt: number }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function createUpstream(getCreds: () => Creds) {
  let token: Token | null = null
  let tokenOwner = ''
  let tokenPromise: Promise<string> | null = null

  /** 凭据变了（首次配置 / 重新填写）就丢掉旧 token */
  function owner(): string {
    const { clientId, clientSecret } = getCreds()
    return `${clientId ?? ''}:${clientSecret ?? ''}`
  }

  function requireCreds(): Required<Creds> {
    const { clientId, clientSecret } = getCreds()
    if (!clientId || !clientSecret) throw new MissingCredsError()
    return { clientId, clientSecret }
  }

  async function requestToken(): Promise<string> {
    const { clientId, clientSecret } = requireCreds()
    const res = await fetch(`${API_ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        client_id: Number(clientId),
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'public',
      }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`token ${res.status}: ${text.slice(0, 200)}`)
    const json = JSON.parse(text) as { access_token: string; expires_in?: number }
    if (!json.access_token) throw new Error(`token 响应没有 access_token: ${text.slice(0, 200)}`)
    return json.access_token
  }

  async function getToken(force = false): Promise<string> {
    const key = owner()
    if (tokenOwner !== key) {
      token = null
      tokenOwner = key
    }
    if (!force && token && token.expiresAt > Date.now()) return token.value
    if (!tokenPromise) {
      const startedKey = key
      tokenPromise = requestToken()
        .then((value) => {
          // 期间用户改了密钥就别把旧 token 记在新密钥名下
          if (tokenOwner === startedKey) {
            token = { value, expiresAt: Date.now() + TOKEN_TTL_MS - TOKEN_SKEW_S * 1000 }
          }
          return value
        })
        .finally(() => {
          tokenPromise = null
        })
    }
    return tokenPromise
  }

  async function callApi(path: string, bearer: string): Promise<{ status: number; body: string }> {
    const res = await fetch(`${API_ORIGIN}/api/v2${path}`, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    })
    return { status: res.status, body: await res.text() }
  }

  /** path 形如 `/users/Kalkai/mania`（不含 /api/v2 前缀） */
  async function request(path: string): Promise<UpstreamResult> {
    requireCreds()

    let bearer = await getToken()
    let result = await callApi(path, bearer)
    if (result.status === 401) {
      bearer = await getToken(true)
      result = await callApi(path, bearer)
    }
    if (result.status === 429) {
      await sleep(1500)
      result = await callApi(path, bearer)
    }
    return result
  }

  return { request, getToken }
}

export type Upstream = ReturnType<typeof createUpstream>