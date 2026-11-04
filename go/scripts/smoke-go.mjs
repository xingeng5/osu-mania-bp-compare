// 冒烟测试：跑一遍 Go 版便携 exe 的主要路径，然后清理测试痕迹。
// 用法：node scripts/smoke-go.mjs   （凭据取上游项目里的 .env.local）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const root = process.cwd()
const exe = path.join(root, 'dist', 'mania-bp-compare.exe')
const envFile = process.env.OSU_ENV_FILE || path.join(root, '..', '.env.local')
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 用自定义 Host 头发请求（fetch 不允许改 Host，需要 node:http） */
function rawGet(port, pathname, hostHeader) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, headers: { Host: hostHeader } },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.end()
  })
}

async function waitUp(base, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + '/api/config')
      if (r.ok) return true
    } catch {}
    await sleep(250)
  }
  return false
}

function start(args, extraEnv) {
  const child = spawn(exe, args, {
    env: { ...process.env, ...extraEnv, OSU_CLIENT_ID: extraEnv.OSU_CLIENT_ID, OSU_CLIENT_SECRET: extraEnv.OSU_CLIENT_SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  return { child, getOut: () => out }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`)
}

// ---- 1. 已配置（环境变量给凭据）----
const PORT_A = 7821
const a = start([`--port=${PORT_A}`, '--no-open'], {
  OSU_CLIENT_ID: env.OSU_CLIENT_ID,
  OSU_CLIENT_SECRET: env.OSU_CLIENT_SECRET,
})
const baseA = `http://127.0.0.1:${PORT_A}`
check('启动并监听', await waitUp(baseA))
const cfg = await (await fetch(baseA + '/api/config')).json()
check('api/config 报告已配置', cfg.configured === true, cfg.configFile + ' @ ' + cfg.configDir)
const home = await fetch(baseA + '/', { redirect: 'manual' })
const homeText = await home.text()
check('首页返回前端', home.status === 200 && homeText.includes('<div id="root"'), `${home.status} ${homeText.length}B`)
const js = [...homeText.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1])[0]
const jsRes = await fetch(baseA + js)
check('内嵌的 js 可取', jsRes.status === 200, `${js} ${(await jsRes.text()).length}B`)
const css = [...homeText.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1])[0]
if (css) {
  const cssRes = await fetch(baseA + css)
  check('内嵌的 css 可取', cssRes.status === 200, `${css}`)
}
const spa = await fetch(baseA + '/some/deep/link')
check('单页回落到 index.html', spa.status === 200 && (await spa.text()).includes('<div id="root"'), String(spa.status))
const nf = await fetch(baseA + '/missing.js')
check('缺失的静态文件 404', nf.status === 404, String(nf.status))

// Host 白名单：挡 DNS rebinding
const rebind = await rawGet(PORT_A, '/api/config', 'evil.example')
check('外来 Host 被 403 拒绝', rebind.status === 403, String(rebind.status))
const viaLocalhost = await rawGet(PORT_A, '/api/config', `localhost:${PORT_A}`)
check('localhost Host 仍可用', viaLocalhost.status === 200, String(viaLocalhost.status))
const wrongPort = await rawGet(PORT_A, '/api/config', 'localhost:9999')
check('端口不符也拒绝', wrongPort.status === 403, String(wrongPort.status))

const mania = await fetch(baseA + '/api/osu/users/Kalkai/mania')
const maniaText = await mania.text()
check('代理 /users/Kalkai/mania', mania.status === 200 && maniaText.includes('variants'), `${mania.status} ${maniaText.length}B`)
const best = await fetch(baseA + '/api/osu/users/10790649/scores/best?mode=mania&limit=100')
const bestText = await best.text()
check('代理 best 成绩', best.status === 200 && bestText.length > 1000, `${best.status} ${bestText.length}B`)
a.child.kill()
await sleep(600)

// ---- 2. 未配置：/ 应跳 /setup，且能校验并写入配置 ----
const PORT_B = 7822
const configFile = path.join(root, 'dist', 'mania-bp-compare.config.json')
const b = start([`--port=${PORT_B}`, '--no-open'], { OSU_CLIENT_ID: '', OSU_CLIENT_SECRET: '' })
const baseB = `http://127.0.0.1:${PORT_B}`
check('第二实例启动', await waitUp(baseB))
const cfgB = await (await fetch(baseB + '/api/config')).json()
check('未配置状态', cfgB.configured === false, cfgB.configDir)
const redirect = await fetch(baseB + '/', { redirect: 'manual' })
check(
  '未配置时 / 跳转 /setup',
  redirect.status === 302 && redirect.headers.get('location') === '/setup',
  `${redirect.status} ${redirect.headers.get('location')}`,
)
const setup = await fetch(baseB + '/setup')
const setupText = await setup.text()
check('/setup 返回设置页', setup.status === 200 && setupText.includes('OAuth'))
check('设置页不暴露绝对路径', !/[A-Za-z]:\\/.test(setupText))
const bad = await fetch(baseB + '/api/config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId: env.OSU_CLIENT_ID, clientSecret: 'x'.repeat(40) }),
})
check('错误密钥被拒绝', bad.status === 400, (await bad.json()).error?.slice(0, 60))
const notDigits = await fetch(baseB + '/api/config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId: 'abc', clientSecret: env.OSU_CLIENT_SECRET }),
})
check('非数字 Client ID 被拒绝', notDigits.status === 400, (await notDigits.json()).error)
const good = await fetch(baseB + '/api/config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId: env.OSU_CLIENT_ID, clientSecret: env.OSU_CLIENT_SECRET }),
})
const goodJson = await good.json()
check('正确密钥通过校验并落盘', good.status === 200 && fs.existsSync(configFile), goodJson.error ?? goodJson.configFile)
if (fs.existsSync(configFile)) {
  const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  check('落盘的凭据内容正确', saved.clientId === env.OSU_CLIENT_ID && saved.clientSecret === env.OSU_CLIENT_SECRET)
}
const after = await fetch(baseB + '/api/osu/users/Kalkai/mania')
check('配置后代理可用', after.status === 200, String(after.status))
const home2 = await fetch(baseB + '/', { redirect: 'manual' })
check('配置后 / 不再跳转', home2.status === 200, String(home2.status))
b.child.kill()
await sleep(600)

if (fs.existsSync(configFile)) fs.unlinkSync(configFile)
let leftover = false
try {
  leftover = fs.readdirSync(path.join(root, 'dist')).some((f) => f !== 'mania-bp-compare.exe')
} catch {}
check('目录里没留下额外文件', !leftover)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)