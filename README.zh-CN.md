# dsh-refine

[English](README.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/dsh-refine.svg?style=flat-square)](https://www.npmjs.com/package/dsh-refine)
[![npm downloads](https://img.shields.io/npm/dm/dsh-refine.svg?style=flat-square)](https://www.npmjs.com/package/dsh-refine)
[![License](https://img.shields.io/npm/l/dsh-refine.svg?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/dushaobindoudou/dsh-refine/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/dushaobindoudou/dsh-refine/actions/workflows/ci.yml)

**DeepSeek Harness (dsh) 的 continual harness 精炼 UX 层**：提供 `/refine` 人类命令与
设置面板（精炼条目浏览、历史时间线、一键回滚、auto-gate 审计）。底层驱动
[`dsh-continual-harness`](https://github.com/jasen215/dsh-continual-harness) 引擎，
运行时引擎**可选**--未装引擎时所有操作优雅降级为可执行指引。

本插件保持**套壳**定位：自 `dsh-continual-harness@0.3.0` 起引擎自行注册 `/refine`
命令，因此引擎挂载时 dsh-refine 把该命令让位给引擎、自身提供设置面板；引擎未挂载时
dsh-refine 仍自带 `/refine`（降级视图）。

本项目是一份对 [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent)
`/refine` 思想的移植与实践，面向 dsh 生态。

## 特性

- **`/refine` 命令**：`status` / `list [kind]` / `history [n]` /
  `rollback <id> [--global|--local]` / 自由文本精炼指令 `[--global|--local]`。
  自 1.2.0 起 dsh-refine 自行挂载引擎（`ctx.isolate('commands')` 隔离掉引擎自带的
  `/refine`），命令始终由套壳独占；profile 的 `bundles` 里只需列 `dsh-refine`
- **设置面板**：精炼 Harness 时间线、条目浏览、一键回滚、auto-gate 审计
- **中英双语 + 明暗主题**：面板随宿主语言自动切换（简体中文 / English），配色只
  用 dsh 设计令牌、随暗黑/浅色主题自适应，不写死亮色 hex
- **会话历史兼容**：旧版引擎写入的 `harness/refinement` 会话事件被注册进宿主读取器，
  旧版引擎产生的会话日志依然可加载（0.3.0 引擎已自注册该类型且不再写入；dsh-refine
  保留幂等防御性注册）
- **宿主缺口桥接**：当已装引擎的转轮代码读取 `session.events`、而宿主只暴露
  `snapshotEvents()` 时，dsh-refine 会安装一个受保护的 `events` getter，避免
  引擎投影/规划每次转轮都抛 `Cannot read properties of undefined (reading 'length')`
- **引擎可选**：未挂载引擎时给出可操作的安装指引，不报错、不污染会话

## 环境要求

- Node.js ≥ 18
- dsh 0.1.2-rc.1+（对齐的 `@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-typert-protocol`）

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
| `/refine list [kind]` | 列出当前条目（可过滤 `prompt`/`memory`/`skill`/`subagent`） |
| `/refine history [n]` | 最近精炼历史（默认 10 条，上限 50） |
| `/refine rollback <id>` | 回滚一次已提交的精炼（id 见 `history`） |
| `/refine <任意指令>` | 触发一次引擎精炼，立即返回；结果稍后在面板/`history` 中呈现 |

> `/refine <文字>` 的语义是把文字当作**精炼指令**交给引擎规划。普通聊天请求请直接在
> 输入框发送，不要带 `/` 前缀。挂载 `dsh-continual-harness@0.3.0+` 时 `/refine` 由引擎
> 接管（plan + rollback），下方的面板仍提供浏览/时间线/一键回滚视图。

### 面板

设置 -> **精炼 Harness**：以设置页式总览展示引擎与状态目录，浏览
`prompt` / `memory` / `skill` / `subagent` 条目、查看历史时间线并一键回滚、
auto-gate 审计。

## 工作原理

```
引擎挂载（dsh-continual-harness@0.3.0+）：
  /refine ──► 引擎自身 /refine ──► coordinator ──► harness_state.json / refinements.jsonl

引擎未挂载：
  /refine ──► dsh-refine /refine ──► tools.execute('harness_refine') ──► 可执行安装指引

面板（始终）：设置 → 精炼 Harness ──► refineUx data/rollback ──► ESP 文件 + harness_refine
```

- 指令触发为**后台 fire-and-forget**：同步校验引擎/agent，随即 ack，避免长时间锁住
  输入框；引擎结果落在面板历史时间线与 `/refine history`。
- 回滚为同步：只应用已存的逆编辑，无 LLM 往返。
- 会话事件兼容：`lib/compat.js` 把 `harness/refinement` 注册进宿主读取器的已知事件
  集合（`KNOWN_SESSION_EVENT_TYPES`），让旧版引擎产生的日志保持可读；0.3.0 起引擎
  不再写入该事件且自注册该类型。

## 开发

```bash
npm install
npm run lint    # ESLint（lib/ + smoke-host.mjs）
npm test        # 冒烟测试（不依赖引擎；dsh 在 PATH 上时额外验证宿主注册）
```

冒烟测试是封闭式的：`~/.dsh/harness` 缺少引擎 ESP 文件时自动生成最小 fixture。用
`DSH_HOME=/tmp/fresh npm test` 可以在干净目录下复现 CI 环境。

开发规范（提交格式、changelog 政策、发布流程）见
[CONTRIBUTING.md](CONTRIBUTING.md)；安全漏洞上报方式见 [SECURITY.md](SECURITY.md)。

## License

[MIT](LICENSE) © dushaobindoudou
