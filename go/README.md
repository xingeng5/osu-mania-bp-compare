# mania BP 对比器（Go 便携版）

把两个 osu!mania 玩家的 BP（前 100 名成绩）并排对比的小工具。功能与 Node 版完全一致，
区别只在实现：**一个 7.3 MB 的单文件 exe，不需要安装 Node**。

| | 本版（Go） | Node SEA 版 |
|---|---|---|
| exe 体积 | **7.3 MB** | 89.6 MB |
| 就绪耗时 | 约 210 ms | 约 610 ms |
| 常驻内存 | 约 9 MB | 约 40 MB |
| 使用者操作 | 双击 → 填凭据 → 用 | 完全一样 |

## 使用

1. 双击 `dist\mania-bp-compare.exe`
2. 首次运行浏览器会打开设置页，填自己的 osu! OAuth `Client ID` / `Client Secret`
   （申请方法见设置页里的三步说明，或主项目 README）
3. 之后每次双击直接进主界面，输入两个玩家名对比
4. 右上角「中文 / English」随时切换界面语言，选择记在本机浏览器里

凭据存在 exe 同目录的 `mania-bp-compare.config.json`（目录不可写时退到
`%LOCALAPPDATA%\mania-bp-compare\`），只在本机使用，不上传任何地方。
端口默认 7788，被占用时自动顺延；`--port=8000` 指定起始端口，`--no-open` 不自动开浏览器。

## 构建

前置：Go 1.22+（本机在 `D:\Program\_go-toolchain\go`）。前端产物从 Node 项目同步。

```bat
build.bat
```

它做两件事：把 `..\dist` 拷进 `web\`（Go 用 `//go:embed` 打进二进制），
然后 `go build -trimpath -ldflags "-s -w"`。

## 测试

```bat
go test ./...
node scripts\smoke-go.mjs
```

- `go test`：用假上游验证 token 复用、401 换 token、429 退避、代理透传、Host 白名单、配置读写校验（不需要真实凭据）。
- `smoke-go.mjs`：启动真实 exe 跑 23 项检查；其中访问 osu 官方接口的几项需要
  `..\.env.local` 里有可用凭据。

## 目录

```
main.go        HTTP 服务、路由、配置读写、Host 白名单
upstream.go    osu! API 封装（token 复用 / 401 / 429，不缓存数据）
setup.go       首次运行的设置页
web/           前端产物（go:embed 打进 exe）
dist/          编译输出
```