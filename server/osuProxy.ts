import type { Plugin } from 'vite'
import { createUpstream, MissingCredsError } from './upstream'

export type OsuProxyOptions = {
  clientId?: string
  clientSecret?: string
}

/**
 * Dev-only proxy: 浏览器 → /api/osu/* → https://osu.ppy.sh/api/v2/*
 * 上游逻辑（token / 缓存 / 429 退避）在 server/upstream.ts，与便携版服务器共用。
 * 密钥只在 Node 侧读取，绝不进入前端 bundle。
 */
export function osuProxy(options: OsuProxyOptions): Plugin {
  const { clientId, clientSecret } = options
  const upstream = createUpstream(() => ({ clientId, clientSecret }))

  return {
    name: 'osu-api-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/osu', (req, res) => {
        const send = (status: number, payload: string, extra?: Record<string, string>) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          for (const [k, v] of Object.entries(extra ?? {})) res.setHeader(k, v)
          res.end(payload)
        }

        // connect 会把挂载前缀从 req.url 里剥掉，但它的类型声明里没写 url
        const path = (req as unknown as { url?: string }).url ?? '/'

        void (async () => {
          try {
            const result = await upstream.request(path)
            send(result.status, result.body)
          } catch (err) {
            if (err instanceof MissingCredsError) {
              send(500, JSON.stringify({ error: '服务器缺少 OSU_CLIENT_ID / OSU_CLIENT_SECRET（检查 .env.local）' }))
              return
            }
            send(502, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
          }
        })()
      })
    },
  }
}