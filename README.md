# dsh-refine

[![npm version](https://img.shields.io/npm/v/dsh-refine.svg?style=flat-square)](https://www.npmjs.com/package/dsh-refine)
[![npm downloads](https://img.shields.io/npm/dm/dsh-refine.svg?style=flat-square)](https://www.npmjs.com/package/dsh-refine)
[![License](https://img.shields.io/npm/l/dsh-refine.svg?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/dushaobindoudou/dsh-refine/ci.yml?style=flat-square&label=ci)](https://github.com/dushaobindoudou/dsh-refine/actions/workflows/ci.yml)

**DeepSeek Harness (dsh) 的 continual harness 精炼 UX 层**：提供 `/refine` 人类命令与
设置面板（精炼条目浏览、历史时间线、一键回滚、auto-gate 审计）。底层驱动
[`dsh-continual-harness`](https://github.com/jasen215/dsh-continual-harness) 引擎，
运行时引擎**可选**——未装引擎时所有操作优雅降级为可执行指引。

本项目是一份对 [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent)
`/refine` 思想的移植与实践，面向 dsh 生态。

## 特性

- **`/refine` 命令**：`status` / `list [kind]` / `history [n]` / `rollback <id>` /
  自由文本精炼指令
- **设置面板**：精炼 Harness 时间线、条目浏览、一键回滚、auto-gate 审计
- **会话历史兼容**：引擎写入的 `harness/refinement` 会话事件自动注册进宿主读取器，
  精炼过的会话日志依然可加载（不依赖数据迁移）
- **引擎可选**：未挂载引擎时给出可操作的安装指引，不报错、不污染会话

## 环境要求

- Node.js ≥ 18
- dsh 0.1.0-rc.6+（含 `@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-typert-protocol`）

## 安装

在 dsh profile（如 `~/.dsh/profiles/web/cordis.yml`）中挂载本包与引擎：

```yaml
plugins:
  - dsh-continual-harness   # 引擎（可选，但装了才能真触发精炼）
  - dsh-refine              # 本 UX 层（必须）
```

或直接用 `link:` 指向本地 checkout 进行开发：

```yaml
plugins:
  - link:/path/to/dsh-refine
```

重启 `dsh web` 后生效（宿主侧改动需要重启，客户端面板改动可在 `pnpm run dev:web`
运行时热更）。

## 用法

### 命令

| 输入 | 说明 |
| --- | --- |
| `/refine status` | 引擎/回滚状态总览 |
| `/refine list [kind]` | 列出当前条目（可过滤 `prompt/memory/skill/subagent`） |
| `/refine history [n]` | 最近精炼历史（默认 10 条，上限 50） |
| `/refine rollback <id>` | 回滚一次已提交的精炼（id 见 `history`） |
| `/refine <任意指令>` | 触发一次引擎精炼，立即返回；结果稍后在面板/`history` 中呈现 |

> `/refine <文字>` 的语义是把文字当作**精炼指令**交给引擎规划。普通聊天请求请直接在
> 输入框发送，不要带 `/` 前缀。

### 面板

设置 → **精炼 Harness**：浏览条目、查看历史时间线、一键回滚、auto-gate 审计。

## 工作原理

```
/refine 命令 ──► dsh-commands ──► dsh-refine (lib/index.js)
                     │                     │
                     │              tools.execute('harness_refine', {signal})
                     ▼                     ▼
              command/run+done      dsh-continual-harness 引擎
                     │                     │
                     └── harness/refinement 会话事件
```

- 指令触发为**后台 fire-and-forget**：同步校验引擎/agent，随即 ack，避免长时间锁住
  输入框；引擎结果落在面板历史时间线与 `/refine history`。
- 回滚为同步：只应用已存的逆编辑，无 LLM 往返。
- 会话事件兼容：`lib/compat.js` 把 `harness/refinement` 注册进宿主读取器的已知事件
  集合（`KNOWN_SESSION_EVENT_TYPES`），一处注册同时治愈旧日志与未来写入。

## 开发

```bash
npm install
npm test        # 冒烟测试（不依赖引擎；dsh 在 PATH 上时额外验证宿主注册）
```

冒烟测试使用真实 dsh 安装路径做兼容性回归（找不到 `dsh` 时优雅跳过相关断言）。

## License

[MIT](LICENSE) © dushaobindoudou
