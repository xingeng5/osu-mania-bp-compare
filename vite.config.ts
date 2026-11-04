import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { osuProxy } from './server/osuProxy'

/**
 * 编辑工具写文件时会在同目录建 `.名字.<pid>.<uuid>.tmpdir/名字.tmp` 再整体 rename，
 * 这个临时目录被删的瞬间 chokidar 正好去 watch 它 → EBUSY 直接崩掉 dev server。
 * 直接把这类临时产物从 watch 里排除。
 */
const IGNORED_TMP = /\.tmpdir[\\/]|\.tmp$|\.tmpdir$/

/**
 * 除了临时目录，`scripts/` 与以 `_` 开头的临时脚本也不参与前端构建；
 * 删掉一个正被 watch 的文件同样会触发 EBUSY 崩溃，所以整体排除。
 */
function isIgnored(p: string): boolean {
  if (IGNORED_TMP.test(p)) return true
  const rel = p.replace(/\\/g, '/')
  if (/\/scripts\//.test(rel)) return true
  if (/\/_[^/]*$/.test(rel)) return true
  return false
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      osuProxy({
        clientId: env.OSU_CLIENT_ID,
        clientSecret: env.OSU_CLIENT_SECRET,
      }),
    ],
    server: {
      port: 5173,
      strictPort: false,
      watch: { ignored: [isIgnored] },
      // 允许通过临时隧道把本机 dev server 暴露给朋友用（cloudflared / ngrok / localtunnel）。
      // 只放行这几个隧道域名，其余 Host 仍然被 Vite 的 DNS-rebinding 防护挡住。
      allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io', '.loca.lt'],
    },
    build: { outDir: 'dist', sourcemap: false },
  }
})