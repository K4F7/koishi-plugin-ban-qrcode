# koishi-plugin-ban-qrcode

[![npm](https://img.shields.io/npm/v/koishi-plugin-ban-qrcode?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-ban-qrcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Koishi](https://img.shields.io/badge/Koishi-4-026d4d?style=flat-square)](https://koishi.chat/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/K4F7/koishi-plugin-ban-qrcode/pulls)

群内检测到图片二维码时自动撤回，并禁言发送者（默认 1 分钟）。用于群管理、拦截广告码。

Recall group QR-code images and mute the sender for one minute by default, to stop advertising codes.

## Features

- 🔍 **扫图识码**：下载消息里的图片，解码是否含二维码
- 🗑️ **自动撤回**：命中后立刻撤回原消息
- 🔇 **自动禁言**：默认禁言 60 秒，秒数可配
- 🛡️ **白名单**：默认跳过群主 / 管理员，也可按用户 ID、群 ID 过滤
- 💬 **群内提示**：处理后可发一句说明，不回显码内内容

## Quick Start

在 [Koishi](https://koishi.chat/) 控制台搜索 `ban-qrcode` 安装，或：

```bash
npm install koishi-plugin-ban-qrcode
```

启用后，群成员发带二维码的图片会被撤回并禁言 1 分钟。机器人需要**撤回消息**和**禁言成员**的权限。

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

插件没有指令。启用后监听群消息：

1. 只处理群聊，忽略私聊和机器人自己的消息
2. 收集消息及引用里的 `img` / `image`
3. 下载图片并解码二维码
4. 命中则撤回、禁言，可选发送提示

不会把解码出的文本发回群里，避免扩散广告链接。

## Configuration

| 项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `muteSeconds` | `number` | `60` | 禁言秒数。`0` 表示只撤回不禁言 |
| `recall` | `boolean` | `true` | 撤回含二维码的消息 |
| `notify` | `boolean` | `true` | 处理后在群内提示 |
| `notifyText` | `string` | `''` | 自定义提示。留空则按秒数生成 |
| `skipAdmins` | `boolean` | `true` | 跳过群主 / 管理员 |
| `ignoreUsers` | `string[]` | `[]` | 忽略的用户 ID |
| `guilds` | `string[]` | `[]` | 只在这些群生效。空数组表示全部群 |

默认提示：`检测到二维码，已撤回并禁言 60 秒。`

## API Reference

插件入口导出 `name`、`inject`、`Config`、`apply`。判定与扫码编排在 `src/detect.ts`，下载和解码在 `src/qrcode.ts`。

### `collectImageSrcs(nodes)`

收集 `img` / `image` 的 `src` 或 `url`，去重并保留顺序，会走进嵌套节点（如引用）。

### `shouldModerate(input)`

群聊、非自己、未忽略、在生效群内，且（可选）不是管理员时返回 `true`。

### `findQrInImages(srcs, download, decode)`

按顺序下载并解码，返回第一张命中的 `{ src, text }`。单张失败会跳过。

### `decodeQr(buffer)`

用 Jimp 读图、jsQR 解码。没有码时返回 `null`。

## Architecture

```
src/
├── index.ts    # 插件入口：监听群消息，撤回 / 禁言 / 提示
├── detect.ts   # 收集图片、是否处理、编排扫码
└── qrcode.ts   # 下载图片、解码二维码
tests/
└── detect.spec.ts
```

数据流：群消息 → 收集图片 URL → 下载 → jsQR → `deleteMessage` + `muteGuildMember`。

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

检查机器人是否有管理员权限，以及适配器是否实现 `deleteMessage` / `muteGuildMember`。权限不足时插件会打日志并继续后续步骤。
</details>

<details>
<summary><strong>管理员发群码会被禁言吗？</strong></summary>

默认不会。`skipAdmins` 为 `true` 时跳过角色为 `owner` / `admin` 的成员。
</details>

<details>
<summary><strong>为什么有的二维码没扫到？</strong></summary>

图太糊、码只占画面很小一块、或格式 Jimp 读不了（少见 webp）时可能漏检。把更清晰的整图发来更容易命中。
</details>

<details>
<summary><strong>会公布码里的链接吗？</strong></summary>

不会。提示语只说明「检测到二维码」，日志也不写码内文本。
</details>

## Troubleshooting

**no bot permission / mute failed**

机器人不是管理员，或目标是群主 / 更高权限成员。看 `ban-qrcode` logger。

**图片下载失败**

图床拒绝、过期或需要登录。插件会跳过这张图，继续扫同一条消息里的其它图。

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
2. 改代码，补测试（`tests/detect.spec.ts`）
3. `npm test` 和 `npm run build` 通过
4. 开 Pull Request

提交信息建议用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:` / `fix:` / `docs:` / `test:` / `chore:`。

## Changelog

当前版本 **1.0.0**：群内扫二维码、自动撤回、默认禁言 60 秒、管理员白名单。

## License

[MIT](./LICENSE) © 2026 koishi-plugin-ban-qrcode contributors

## Support

- 🐛 Issues：[github.com/K4F7/koishi-plugin-ban-qrcode/issues](https://github.com/K4F7/koishi-plugin-ban-qrcode/issues)
- 📦 npm：[koishi-plugin-ban-qrcode](https://www.npmjs.com/package/koishi-plugin-ban-qrcode)
- 📖 Koishi 文档：[koishi.chat](https://koishi.chat/)
