# mania BP 对比器

osu!mania 双人 BP（top plays）对比工具：在同一键数与平台口径下并排看两个人的图池，标出 pp差值、补分增益，还能勾选多张图算「补上这些成绩能涨多少 pp」。

单文件 exe，双击即用，不需要装 Node、不需要装谱面。前端源码在本目录；分发用的 7 MB 单文件 exe 由 `go\` 子目录编译产出（Go 把这份 `dist/` 嵌进二进制）。

## 怎么用

1. **双击 `mania-bp-compare.exe`** —— 会自动打开浏览器（默认 `http://127.0.0.1:7788`）
2. **首次启动**会跳到设置页，填一串 osu! OAuth 凭据：
   - 打开 <https://osu.ppy.sh/home/account/edit>，拉到页面底部 **OAuth** 区块
   - 点 **New OAuth Application**：Name 随便填，Redirect URL 填 `http://localhost:7788/callback`（本程序用不到，但表单必填）
   - 创建后把 **Client ID** 和 **Client Secret** 填进设置页，点「保存并开始」
3. **输入两个玩家**（用户名 / 数字 ID / `osu.ppy.sh/users/...`）

凭据只需要填这一次，之后双击就用。想换人重填：访问 `http://127.0.0.1:7788/setup`。

## 界面上有什么

| 区域 | 作用 |
|---|---|
| 键数选择 | `4K (A:78 / B:65)` 这样显示双方在该键数下各有多少条 BP；1K–3K 不参与 |
| 平台筛选 | 全部 / 相同平台 / 仅 STB / 仅 LZR；切换后会提示隐藏了多少条跨平台对比 |
| 并排 | 双方同一个名次并排（A 的第 1 名对 B 的第 1 名），只用来对照位置，不表示水平差 |
| 同图 | 双方打过的图合并列表：只有一方有的也列出来，另一侧灰显谱面、pp差值 按 0pp 计 |
| 仅A有 / 仅B有 | 差集。仅 B 有 = 对方有而你没有的图，适合当「上分候选」看 |
| pp差值与增益 | pp差值是同图水平差；增益是「把这张图的成绩给对面，加权总 pp 会涨多少」 |
| 多选批量 | 勾若干行，工具条会算「若A打出相同成绩 / 若B打出相同成绩」各涨多少 pp（一次性重算，不是逐条相加） |
| 筛选条 | rate mod（NM/DT/HT）、星数区间、年份、`\|pp差值\| ≥` |
| 收起设置 | 在「仅B有」右边，收起后只剩一行口径摘要，把屏幕全留给表格 |
| 界面语言 | 右上角「中文 / English」，选择存在浏览器本地，下次打开沿用 |

## 安全说明

### 凭据存储位置

| 项 | 位置 |
|---|---|
| 凭据文件 | **本程序所在目录**的 `mania-bp-compare.config.json`（该目录不可写时改用 `%LOCALAPPDATA%\mania-bp-compare\`） |

### 凭据泄露了怎么办

去 <https://osu.ppy.sh/home/account/edit> 的 OAuth 区块，把那个应用**删掉重建**（页面上有重置 secret 的选项就用它，没有就删了重建），拿到新的 ID / Secret 重新填。旧 secret 立刻失效。只改应用名字没有用——名字不影响密钥有效性。

## 目录与卸载

两个文件，都在它所在的文件夹里：

- `mania-bp-compare.exe`
- `mania-bp-compare.config.json`（填了凭据才会有）

**卸载 = 删掉这两个文件**

## 维护者：改完之后怎么出包

```powershell
# 本目录：改前端，出 dist/
pnpm install
pnpm build

# go\：把 ..\dist 嵌进 exe
cd go
build.bat
```

`build.bat` 会先清空 `web\` 再同步新的 `dist\`（避免哈希文件名的旧资源堆着），然后编译 `dist\mania-bp-compare.exe`。
