# koishi-plugin-ban-qrcode

[![npm](https://img.shields.io/npm/v/koishi-plugin-ban-qrcode?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-ban-qrcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Koishi](https://img.shields.io/badge/Koishi-4-026d4d?style=flat-square)](https://koishi.chat/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/K4F7/koishi-plugin-ban-qrcode/pulls)

群内检测到图片二维码、邀请 / 推荐群聊分享卡，或「大一新生必备清单」一类文档里的卖货广告时，自动撤回并禁言发送者（默认 1 分钟）。

Recall QR-code images, group-invite share cards, and freshman-list document ads, then mute the sender for one minute by default.

## Features

- 🔍 **扫图识码**：下载消息里的图片，解码是否含二维码
- 📎 **拉群卡片**：识别 QQ 邀请加群 / 推荐群聊 / 群名片分享卡
- 📄 **文档广告**：拉取腾讯文档（含微信 / QQ 小程序卡片）或 Word / 文本附件正文，识别夹带的床品推销等广告
- 🗑️ **自动撤回**：命中后立刻撤回原消息
- 🔇 **自动禁言**：默认禁言 60 秒，秒数可配
- 🛡️ **白名单**：默认跳过群主 / 管理员，也可按用户 ID、群 ID 过滤
- 💬 **群内提示**：处理后可发一句说明，不回显码内内容或广告原文

## Quick Start

在 [Koishi](https://koishi.chat/) 控制台搜索 `ban-qrcode` 安装，或：

```bash
npm install koishi-plugin-ban-qrcode
```

启用后，群成员发带二维码的图片、拉群分享卡，或夹带卖货广告的腾讯文档 / Word，会被撤回并禁言 1 分钟。机器人需要**撤回消息**和**禁言成员**的权限。

依赖 Koishi 的 `http` 服务（`inject: ['http']`）。

## Installation

### Prerequisites

- [Koishi](https://koishi.chat/) `^4.18.7`
- Node.js 18 或更高（发布流水线使用 Node 24）
- 适配器实现 `deleteMessage` 和 `muteGuildMember`（QQ / OneBot 等群聊平台）

### Package Manager

```bash
# npm
npm install koishi-plugin-ban-qrcode

# pnpm
pnpm add koishi-plugin-ban-qrcode

# yarn
yarn add koishi-plugin-ban-qrcode
```

安装后在控制台启用插件 `ban-qrcode`。

### From Source

```bash
git clone https://github.com/K4F7/koishi-plugin-ban-qrcode.git
cd koishi-plugin-ban-qrcode
npm install
npm test
npm run build
```

`tsc -b` 输出到 `lib/`。GitHub Actions 发布也走这一套。

## Usage

插件没有指令。启用后监听群消息，命中任一项则按同一套流程撤回、禁言、提示：

1. 只处理群聊，忽略私聊和机器人自己的消息
2. 图片二维码：收集 `img` / `image`，下载后解码
3. 拉群卡片：识别 `json` / `xml` / `contact` 分享卡（`com.tencent.qun.invite`、群名片、`[推荐群]` 等）
4. 文档广告：从文本、新闻卡、微信 / QQ 小程序腾讯文档卡里取出 `docs.qq.com` / `doc.weixin.qq.com` 链接（含编码过的小程序 path、`qqdocurl`），或下载 `.doc` / `.docx` / `.txt`，识别夹带的推销文案（例如校园床品「送货到寝」）
5. 文档里的图也会再扫一遍二维码

不会把解码出的文本或广告原文发回群里。纯物品清单（只写「被子、枕头」而没有推销）不会误杀。

## Configuration

| 项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `muteSeconds` | `number` | `60` | 禁言秒数。`0` 表示只撤回不禁言 |
| `recall` | `boolean` | `true` | 撤回违规消息 |
| `notify` | `boolean` | `true` | 处理后在群内提示 |
| `notifyText` | `string` | `''` | 自定义提示。留空则按原因和秒数生成 |
| `skipAdmins` | `boolean` | `true` | 跳过群主 / 管理员 |
| `ignoreUsers` | `string[]` | `[]` | 忽略的用户 ID |
| `guilds` | `string[]` | `[]` | 只在这些群生效。空数组表示全部群 |
| `scanQrcode` | `boolean` | `true` | 扫描图片二维码 |
| `scanGroupInvite` | `boolean` | `true` | 拦截邀请 / 推荐群聊分享卡 |
| `scanDocs` | `boolean` | `true` | 检查腾讯文档和 Word / 文本附件 |
| `adKeywords` | `string[]` | `[]` | 额外广告关键词，命中即撤回 |
| `maxOfficeMb` | `number` | `5` | Word / 文本附件的大小上限（MB），超出则跳过 |
| `debug` | `boolean` | `true` | 输出调试日志：跳过原因、消息结构、下载 / 扫码 / 文档结果 |

内置词在 `src/ad-keywords.txt`，一行一条。`[strong]` 命中任意一条即撤回；`[commerce]` 要同时出现床品类用词且至少两条。控制台 `adKeywords` 按强匹配叠加。

默认提示按原因变化，例如：`检测到拉群卡片，已撤回并禁言 60 秒。` / `检测到文档广告，已撤回并禁言 60 秒。`

## API Reference

插件入口导出 `name`、`inject`、`Config`、`apply`。判定与扫码编排在 `src/detect.ts`，拉群卡在 `src/share.ts`，文档广告在 `src/ad.ts` / `src/ad-keywords.txt` / `src/document.ts`，下载和解码在 `src/qrcode.ts`。内置广告词在 `ad-keywords.txt` 里一行一条；控制台 `adKeywords` 仍是额外覆盖。

### `collectImageSrcs(nodes)`

收集 `img` / `image` 的 `src` 或 `url`，去重并保留顺序，会走进嵌套节点（如引用）。

### `shouldModerate(input)`

群聊、非自己、未忽略、在生效群内，且（可选）不是管理员时返回 `true`。

### `findQrInImages(srcs, download, decode)`

按顺序下载并解码，返回第一张命中的 `{ src, text }`。单张失败会跳过。

### `decodeQr(buffer)`

用 Jimp 读图，先 jsQR、再微信扫码器解码。没有码时返回 `null`。

## Architecture

```
src/
├── index.ts           # 插件入口：监听群消息，撤回 / 禁言 / 提示
├── detect.ts          # 收集图片 / 卡片 / 文件、是否处理、提示语
├── share.ts           # 识别 QQ 拉群分享卡
├── ad.ts              # 识别文档里的卖货文案
├── ad-keywords.txt    # 内置广告关键词，一行一条
├── document.ts        # 拉腾讯文档、抽出 Word / 文本
└── qrcode.ts          # 下载图片、解码二维码
tests/
├── detect.spec.ts
├── share.spec.ts
├── ad.spec.ts
└── document.spec.ts
```

数据流：群消息 → 二维码 / 拉群卡 / 文档正文 → `deleteMessage` + `muteGuildMember`。

禁言时长按 Satori 约定传**毫秒**（60 秒 = `60000`）。

## 工作区开发

按 [Koishi 工作区开发](https://koishi.chat/zh-CN/guide/develop/workspace.html)：本仓库是**独立插件仓**，官方 Yakumo 工作区只用于本地调试，不要把整个工作区提交进来。

```bash
npm init koishi@latest
cd <app>
```

把本仓接到工作区的 `external/ban-qrcode`（Windows 可用目录联接）：

```bat
mklink /J external\ban-qrcode D:\path\to\koishi-plugin-ban-qrcode
```

或：

```bash
npm run clone K4F7/koishi-plugin-ban-qrcode
```

与 `jandan` 等其它插件一起放在同一个 Yakumo 工作区即可联合调试：

```
koishi-workspace/
├── external/
│   ├── jandan          # junction → 独立仓
│   └── ban-qrcode      # junction → 独立仓
├── koishi.yml
└── package.json
```

然后在工作区根目录：

```bash
yarn dev
```

插件会以 `ban-qrcode` 的名字热重载。本仓自己构建、测试：

```bash
npm install
npm test
npm run build
```

## FAQ

<details>
<summary><strong>为什么没有撤回或禁言？</strong></summary>

先看 `ban-qrcode` 日志。自测最常见是自己是群主 / 管理员，默认 `skipAdmins` 会直接跳过（日志 `skip admin`）。把该项关掉，或用普通成员号发。

也检查机器人是否有撤回 / 禁言权限。适配器没实现 `deleteMessage` / `muteGuildMember` 时会打 warn。
</details>

<details>
<summary><strong>管理员发群码会被禁言吗？</strong></summary>

默认不会。`skipAdmins` 为 `true` 时跳过角色为 `owner` / `admin` 的成员。
</details>

<details>
<summary><strong>为什么有的二维码没扫到？</strong></summary>

先看日志是 `qr error`（图没下下来）还是 `qr miss`（下到了但没解出来）。下载走 Koishi 的 `http.file`，OneBot 还会再试 `get_image`。解码先 jsQR，失败再走官方 `qrcode-service` 同款的微信扫码器。图太糊、码只占画面很小一块仍可能漏检。
</details>

<details>
<summary><strong>会公布码里的链接吗？</strong></summary>

不会。提示语只说明「检测到二维码」，日志也不写码内文本。
</details>

<details>
<summary><strong>推荐好友名片也会撤回吗？</strong></summary>

不会。只拦邀请加群、推荐群聊、群名片。推荐好友、腾讯文档新闻卡本身不按拉群卡处理；文档卡会再去拉正文看有没有广告。
</details>

## Troubleshooting

**no bot permission / mute failed**

机器人不是管理员，或目标是群主 / 更高权限成员。看 `ban-qrcode` logger。

**图片下载失败**

图床拒绝、过期或需要登录。插件会跳过这张图，继续扫同一条消息里的其它图。

**腾讯文档没拦下来**

链接要能不登录打开。插件走公开页 + `dop-api/opendoc` 抽正文；若文档加密、仅登录可见，或正文里没有推销用语，就不会撤回。真正的物品清单（只列「被子、枕头」）不会当广告。

## 发布（OIDC Trusted Publishing）

仓库：[`K4F7/koishi-plugin-ban-qrcode`](https://github.com/K4F7/koishi-plugin-ban-qrcode)

工作流：[`.github/workflows/publish.yml`](.github/workflows/publish.yml)。推送 `v*` tag 后由 GitHub Actions 用 OIDC 发布，**不需要 `NPM_TOKEN`**。

### 你需要在 npm 上完成（无法代做）

1. 打开 [npmjs.com](https://www.npmjs.com/) 登录，进入 `koishi-plugin-ban-qrcode` 的包设置（新包可先配 **pending trusted publisher**）
2. 配置 Trusted Publisher：
   - Provider：GitHub Actions
   - Organization or user：`K4F7`
   - Repository：`koishi-plugin-ban-qrcode`
   - Workflow filename：必须是 `publish.yml`（不要带路径）
   - 允许 `npm publish`
3. 新包可先配 pending trusted publisher，再打 `v1.0.0`；若 npm 要求先有包，用一次性 granular token 发首版再切 OIDC
4. 首发成功后建议在包设置里开启「Require 2FA and disallow tokens」

### 打正式版

确认 Trusted Publisher 已配好、`package.json` 的 `version` 与 tag 一致后：

```bash
git tag v1.0.0
git push origin v1.0.0
```

Actions 会 `npm ci` → `npm test` → `npm run build` → `npm publish --access public`，并自动带 provenance。

## Contributing

欢迎提 issue 和 PR。

1. Fork 仓库，建分支：`git checkout -b feat/my-change`
2. 改代码，补测试（`tests/*.spec.ts`）
3. `npm test` 和 `npm run build` 通过
4. 开 Pull Request

提交信息建议用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:` / `fix:` / `docs:` / `test:` / `chore:`。

## Changelog

当前版本 **1.3.0**：识别微信 / QQ 小程序腾讯文档卡，还原 `docs.qq.com` 链接后再按原逻辑拉正文。1.2.1：Word / 文本附件默认限制 5MB（`maxOfficeMb`）。1.2.0 起内置广告词改到 `ad-keywords.txt` 维护。1.1.3 补拦 QQ 群名片。1.1.2 修复 OneBot `getImage` 未绑定导致的生产崩溃。1.1.1 补齐跳过原因日志。1.1.0 起拦截拉群分享卡和腾讯文档 / Word 广告。

## License

[MIT](./LICENSE) © 2026 koishi-plugin-ban-qrcode contributors

## Support

- 🐛 Issues：[github.com/K4F7/koishi-plugin-ban-qrcode/issues](https://github.com/K4F7/koishi-plugin-ban-qrcode/issues)
- 📦 npm：[koishi-plugin-ban-qrcode](https://www.npmjs.com/package/koishi-plugin-ban-qrcode)
- 📖 Koishi 文档：[koishi.chat](https://koishi.chat/)
