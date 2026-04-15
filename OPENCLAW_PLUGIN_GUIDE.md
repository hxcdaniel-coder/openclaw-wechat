# OpenClaw-WeChat 插件使用指南（给 Agent 看的）

## 项目概述

这是基于 `liangminmx/cli-in-wechat` 的 OpenClaw 优化版本，让任意 OpenClaw agent 可以通过微信接入。

**仓库地址**：https://github.com/hxcdaniel-coder/openclaw-wechat

---

## 功能列表

### 基础功能（继承自上游）

- 7 大 CLI 工具支持：Claude / Codex / Gemini / Hermes / Kimi / OpenClaw / OpenCode
- 会话续接
- `/resume` 历史会话浏览
- 工具接力（`>>`）
- 链式调用（`@tool1>tool2`）
- 40+ `/` 命令

### OpenClaw 专属增强功能

| 功能 | 命令/语法 | 说明 |
|------|----------|------|
| 列出可用 agent | `/agent list` | 显示 dev, cto, qc, main |
| 切换 agent | `/agent use <name>` | 切换到指定 agent |
| 直接 @agent | `@agent-dev 帮我分析代码` | 直接调用特定 agent |
| 查看状态 | `/oc-status` | 显示 OpenClaw 状态和当前 agent |
| 会话列表 | `/oc-resume` | 开发中... |

### 媒体文件发送功能

| 功能 | 命令/语法 | 说明 |
|------|----------|------|
| 发送图片 | `/sendimage <图片路径>` | 发送图片到微信 |
| 发送文件 | `/sendfile <文件路径> [文件名]` | 发送文件到微信 |

---

## 代码使用方式

### 初始化

```typescript
import { ILinkClient } from './ilink/client.js';
import { Router } from './bridge/router.js';

const credentials = loadCredentials(); // 从 ~/.wx-ai-bridge/credentials.json 加载
const ilink = new ILinkClient(credentials);
const registry = new AdapterRegistry();
const sessions = new SessionManager();
const config = loadConfig();

const router = new Router(ilink, registry, sessions, config);
router.start();
```

### 发送图片（代码调用）

```typescript
// 方式 1：通过 Router
router.sendImage(userId, "/path/to/image.png");

// 方式 2：直接通过 ILinkClient
ilink.sendImage(userId, "/path/to/image.png");
```

### 发送文件（代码调用）

```typescript
// 方式 1：通过 Router
router.sendFile(userId, "/path/to/file.pdf", "文件名.pdf");

// 方式 2：直接通过 ILinkClient
ilink.sendFile(userId, "/path/to/file.pdf", "文件名.pdf");
```

---

## 目录结构

```
openclaw-wechat/
├── src/
│   ├── index.ts              # 入口
│   ├── config.ts             # 配置
│   ├── ilink/               # 微信 iLink Bot API
│   │   ├── types.ts        # 协议类型（新增 GetUploadUrlResponse）
│   │   ├── auth.ts         # QR 扫码登录
│   │   └── client.ts       # 长轮询 + 发消息 + typing + sendImage/sendFile
│   ├── adapters/            # CLI 工具适配器
│   │   ├── base.ts         # 接口 + 共享 helpers
│   │   ├── openclaw.ts     # 🔥 增强版 OpenClaw 适配器（支持 --agent）
│   │   ├── claude.ts       # 不变
│   │   └── ...             # 其他保持不变
│   └── bridge/             # 桥接逻辑
│       ├── session.ts      # 会话管理
│       ├── formatter.ts    # 响应格式化
│       └── router.ts       # @ 路由 + / 命令 + >> 接力 + sendImage/sendFile
├── docs/
│   └── OPENCLAW_GUIDE.md   # OpenClaw 使用指南
└── OPENCLAW_PLUGIN_GUIDE.md # 本文档（给 Agent 看的）
```

---

## 关键文件修改记录

| 文件 | 修改内容 |
|------|----------|
| `src/ilink/types.ts` | 新增 `GetUploadUrlResponse` 接口 |
| `src/ilink/client.ts` | 新增 `getUploadUrl()`、`uploadToCDN()`、`sendImage()`、`sendFile()` 方法 |
| `src/adapters/openclaw.ts` | 增强支持 `--agent` 参数 |
| `src/bridge/router.ts` | 新增 `/agent`、`/oc-status`、`/oc-resume`、`/sendimage`、`/sendfile` 命令，新增 `sendImage()`、`sendFile()` 对外方法 |

---

## 技术细节

### 媒体文件发送流程

1. **调用 `getuploadurl`** - 获取 CDN 上传地址和 AES 密钥
2. **AES-128-ECB 加密** - 使用获取的密钥加密文件
3. **上传到 CDN** - PUT 加密文件到预签名 URL
4. **发送消息** - 在 sendmessage 中带上加密参数和密钥

### OpenClaw Agent 选择

- 在 `settings` 中存储 `currentOpenClawAgent`
- `OpenClawAdapter.execute()` 读取该值并添加 `--agent <name>` 参数
- 支持通过 `@agent-xxx` 语法或 `/agent use` 命令切换

---

## 配置文件

**位置**：`~/.wx-ai-bridge/config.json`

```json
{
  "defaultTool": "openclaw",
  "workDir": "/path/to/workspace"
}
```

---

## 与上游仓库的关系

- **Fork 来源**：https://github.com/liangminmx/cli-in-wechat
- **保持兼容性**：所有上游功能都保留
- **只增强 OpenClaw 相关**：不破坏其他工具的功能

---

**最后更新**：2026-04-15
