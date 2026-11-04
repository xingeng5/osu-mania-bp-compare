// 首次运行时的设置页：填自己的 osu! OAuth 凭据。
// 页面只显示相对位置（程序可以放在任何目录），不出现绝对路径。
// 界面中英双语，语言选择与主界面共用同一个 localStorage 键。
package main

const setupHTML = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8">
<title>mania BP Compare</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; font:15px/1.6 "Segoe UI",system-ui,sans-serif; background:#0e1117; color:#e6edf3;
         display:flex; justify-content:center; padding:8vh 20px }
  main { width:100%; max-width:560px }
  .top { display:flex; align-items:center; gap:10px; margin:0 0 6px }
  h1 { font-size:20px; margin:0 }
  .lang { margin-left:auto; display:flex; gap:4px }
  .lang button { margin:0; padding:3px 9px; background:#161b22; border:1px solid #2b3442;
                 color:#9aa4b2; border-radius:999px; font-size:12px; cursor:pointer }
  .lang button.on { color:#e6edf3; border-color:#39424f; background:#1a2029 }
  p  { color:#9aa4b2; margin:6px 0 }
  ol { color:#9aa4b2; font-size:13px; padding-left:20px; margin:10px 0 18px }
  code { background:#1a2029; padding:1px 5px; border-radius:4px; font-size:12px }
  label { display:block; font-size:12px; color:#9aa4b2; margin:14px 0 4px }
  input { width:100%; box-sizing:border-box; padding:9px 11px; border-radius:6px;
          border:1px solid #2b3442; background:#0b0f14; color:#e6edf3; font-family:inherit }
  button.go { margin-top:18px; padding:10px 18px; border-radius:6px; border:0; background:#238636;
              color:#fff; font-size:14px; cursor:pointer }
  button.go:disabled { opacity:.55; cursor:progress }
  .msg { margin-top:14px; font-size:13px; min-height:20px }
  .msg.err { color:#ff7b72 } .msg.ok { color:#7ee787 }
  .path { margin-top:22px; font-size:12px; color:#6e7681 }
  .path code { font-size:11px }
</style>
<body><main>
  <div class="top">
    <h1 id="t-title">mania BP 对比器</h1>
    <div class="lang" id="lang"></div>
  </div>
  <p id="t-intro"></p>
  <ol>
    <li id="t-step1"></li>
    <li id="t-step2"></li>
    <li id="t-step3"></li>
  </ol>
  <form id="f">
    <label for="id">Client ID</label>
    <input id="id" name="clientId" autocomplete="off" inputmode="numeric" placeholder="12345">
    <label for="secret">Client Secret</label>
    <input id="secret" name="clientSecret" autocomplete="off" type="password" placeholder="xxxxxxxx">
    <button class="go" id="go" type="submit"></button>
    <div class="msg" id="msg"></div>
  </form>
  <div class="path" id="t-path"></div>
</main>
<script>
  var LANG_KEY = 'mania-bp-compare.lang'
  var DICT = {
    zh: {
      title: 'mania BP 对比器',
      intro: '这个程序需要一个 osu! OAuth 应用来读取公开数据。凭据只存在你自己的电脑上，不会上传到任何地方。',
      step1: ['打开 ', 'osu.ppy.sh/home/account/edit', ' → 页面底部 OAuth → New OAuth Application'],
      step2: ['Name 随便写；Redirect URL 填 ', 'http://localhost:7788/callback', '（这个程序用不到，但表单必填）'],
      step3: ['创建后复制 Client ID 与 Client Secret 填到下面'],
      save: '保存并开始',
      verifying: '正在验证…',
      configuring: '已配置，重新填写会覆盖原凭据。',
      done: '验证通过，正在进入…',
      fail: '失败：',
      path: ['凭据保存在：本程序所在目录的 ', 'mania-bp-compare.config.json', '（该目录不可写时改用 %LOCALAPPDATA%\\mania-bp-compare\\）'],
      codeBodyTooLarge: '请求体过大',
      codeBadJSON: '请求体不是合法 JSON',
      codeInvalidId: 'Client ID 应该是纯数字',
      codeShortSecret: 'Client Secret 看起来不完整',
      codeRejected: 'osu 拒绝了这组凭据：',
      codeWriteFailed: '无法写入配置文件：',
      codeHttp: '请求失败'
    },
    en: {
      title: 'mania BP Compare',
      intro: 'This app needs an osu! OAuth application to read public data. Your credentials stay on your own computer and are never uploaded.',
      step1: ['Open ', 'osu.ppy.sh/home/account/edit', ' → scroll to OAuth → New OAuth Application'],
      step2: ['Name: anything. Redirect URL: ', 'http://localhost:7788/callback', ' (unused here, but the form requires it)'],
      step3: ['Copy the Client ID and Client Secret and paste them below'],
      save: 'Save and start',
      verifying: 'Verifying…',
      configuring: 'Already configured — saving again overwrites the current credentials.',
      done: 'Verified. Opening…',
      fail: 'Failed: ',
      path: ['Credentials are saved to ', 'mania-bp-compare.config.json', ' next to this program (or %LOCALAPPDATA%\\mania-bp-compare\\ if that folder is not writable).'],
      codeBodyTooLarge: 'Request body too large',
      codeBadJSON: 'Request body is not valid JSON',
      codeInvalidId: 'Client ID must be all digits',
      codeShortSecret: 'Client Secret looks incomplete',
      codeRejected: 'osu! rejected these credentials: ',
      codeWriteFailed: 'Cannot write the config file: ',
      codeHttp: 'Request failed'
    }
  }

  function readLang() {
    try {
      var v = localStorage.getItem(LANG_KEY)
      if (v === 'zh' || v === 'en') return v
    } catch (e) {}
    return (navigator.language || 'en').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
  }
  var lang = readLang()

  function rich(el, parts) {
    el.textContent = ''
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var c = document.createElement('code')
        c.textContent = parts[i]
        el.appendChild(c)
      } else if (parts[i]) {
        el.appendChild(document.createTextNode(parts[i]))
      }
    }
  }

  function apply(l) {
    lang = l
    var d = DICT[l]
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
    document.title = d.title
    document.getElementById('t-title').textContent = d.title
    document.getElementById('t-intro').textContent = d.intro
    rich(document.getElementById('t-step1'), d.step1)
    rich(document.getElementById('t-step2'), d.step2)
    document.getElementById('t-step3').textContent = d.step3
    document.getElementById('t-path').innerHTML = ''
    var p = document.getElementById('t-path')
    var tmp = document.createElement('span')
    rich(tmp, d.path)
    p.appendChild(tmp)
    document.getElementById('go').textContent = d.save
    var box = document.getElementById('lang')
    box.innerHTML = ''
    ;[['zh', '中文'], ['en', 'English']].forEach(function (pair) {
      var b = document.createElement('button')
      b.type = 'button'
      b.textContent = pair[1]
      if (pair[0] === l) b.className = 'on'
      b.onclick = function () {
        try { localStorage.setItem(LANG_KEY, pair[0]) } catch (e) {}
        apply(pair[0])
        render()
      }
      box.appendChild(b)
    })
  }

  var msg = document.getElementById('msg')
  var go = document.getElementById('go')
  var state = { configured: false, note: '' }

  function show(kind, text) {
    msg.className = 'msg' + (kind ? ' ' + kind : '')
    msg.textContent = text
  }

  function render() {
    if (state.configured) show('ok', DICT[lang].configuring)
  }

  function errText(data) {
    var d = DICT[lang]
    var key = 'code' + (data.code ? data.code.charAt(0).toUpperCase() + data.code.slice(1) : 'Http')
    var base = d[key] || d.codeHttp
    if (data.code === 'rejected' || data.code === 'writeFailed') return base + (data.detail || data.error || '')
    if (data.code && d[key]) return base
    return base + (data.detail || data.error || '')
  }

  fetch('/api/config').then(function (r) { return r.json() }).then(function (d) {
    state.configured = !!d.configured
    if (d.clientId) document.getElementById('id').value = d.clientId
    render()
  }).catch(function () {})

  document.getElementById('f').addEventListener('submit', async function (e) {
    e.preventDefault()
    go.disabled = true
    show('', DICT[lang].verifying)
    try {
      var res = await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: document.getElementById('id').value.trim(),
          clientSecret: document.getElementById('secret').value.trim()
        })
      })
      var data = {}
      try { data = await res.json() } catch (e2) {}
      if (!res.ok) throw new Error(errText(data))
      show('ok', DICT[lang].done)
      setTimeout(function () { location.replace('/') }, 500)
    } catch (err) {
      show('err', DICT[lang].fail + err.message)
      go.disabled = false
    }
  })

  apply(lang)
</script></html>`