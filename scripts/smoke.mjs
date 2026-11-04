// 冒烟测试：dev server 是否起来 + 代理是否能把 osu API 数据取回来
const BASE = 'http://127.0.0.1:5173'

async function check(name, fn) {
  try {
    const out = await fn()
    console.log(`ok   ${name} -> ${out}`)
    return true
  } catch (err) {
    console.log(`FAIL ${name} -> ${err.message}`)
    return false
  }
}

const results = []

results.push(
  await check('index.html', async () => {
    const res = await fetch(BASE + '/')
    const html = await res.text()
    if (!res.ok) throw new Error(`status ${res.status}`)
    if (!html.includes('id="root"')) throw new Error('no #root')
    return `${res.status} ${html.length}B`
  }),
)

results.push(
  await check('main.tsx transform', async () => {
    const res = await fetch(BASE + '/src/main.tsx')
    const js = await res.text()
    if (!res.ok) throw new Error(`status ${res.status}`)
    if (!js.includes('createRoot')) throw new Error('not transformed as expected')
    return `${res.status} ${js.length}B`
  }),
)

results.push(
  await check('proxy /users/Kalkai/mania', async () => {
    const res = await fetch(BASE + '/api/osu/users/Kalkai/mania')
    const json = await res.json()
    if (!res.ok) throw new Error(`status ${res.status} ${JSON.stringify(json).slice(0, 120)}`)
    const variants = json?.statistics?.variants ?? []
    return `user=${json.username} variants=${variants.map((v) => `${v.variant}:${Math.round(v.pp)}pp`).join(',')}`
  }),
)

results.push(
  await check('proxy best scores (username → id → best)', async () => {
    const u = await fetch(BASE + '/api/osu/users/Kalkai/mania')
    const user = await u.json()
    if (!u.ok) throw new Error(`user status ${u.status}`)
    // 实测：scores/best 只认数字 id，用户名会 404，所以必须先解析 id
    const res = await fetch(BASE + `/api/osu/users/${user.id}/scores/best?mode=mania&limit=100`)
    const json = await res.json()
    if (!res.ok) throw new Error(`status ${res.status}`)
    if (!Array.isArray(json)) throw new Error('not an array')
    const sample = json.slice(0, 3).map((s) => `${s.pp.toFixed(0)}pp/${s.beatmap?.cs}K/${s.type}`)
    const types = {}
    for (const s of json) types[s.type] = (types[s.type] ?? 0) + 1
    return `n=${json.length} types=${JSON.stringify(types)} sample=${sample.join(' | ')}`
  }),
)

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)