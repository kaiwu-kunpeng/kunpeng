# 鲲鹏 orchestrator

为个人开发者打造的全自动、可靠的 AI 研发军团。丢进一个需求或方案，军团跑完 `spec → 实现 → 验证 → 交付`，只在不可逆的地方停下来等人工门。**可靠 > 规模，自动 > 花哨。**

本目录是鲲鹏的 TS/Node 实现（编排器 + `kunpeng` CLI）。治理协议、宪法、角色卡放在仓库根的 `~/kunpeng/`（鲲鹏 HOME），与本实现解耦。

## 核心理念

- **主 agent + 按需子 agent**：不养固定编制（C9）。简单需求可不起子 agent 直接做；复杂需求由主 agent 分解派活，子 agent 领短目标、完成回摘要即弃。
- **登录态 CLI，零 API key**：子 agent 后端默认 `claude -p`，可切 `codex exec`（`KUNPENG_BACKEND`）。用你已登录的 CLI，不碰 API key。
- **单写者 + worktree 隔离**：任一时刻一条 flow 的代码写锁只属于一个实现者（C1）；并行 flow 各自独立 git worktree，互不踩踏。
- **三道人工门**：合并主干 / 改宪法 / 对外发布，永不自动越过（C5）。其余全流程自动。
- **确定性优先**：能用 grep/lint/test/typecheck 判定的绝不调 LLM（C8）。
- **差分验证**：真项目基线常本就红，验证门只拦「基线之外的新错」，不要求整库全绿。

宪法 C1–C9 见 [`../constitution/core.md`](../constitution/core.md)，此处不复述。

## 快速开始

需要 **Node >= 20**。

```bash
npm i           # 装依赖
npm run build   # tsc 编译到 dist/（CLI bin = dist/cli.js）
npm test        # vitest run
npm run typecheck   # tsc --noEmit，不出产物只查类型
```

构建后可执行 `node dist/cli.js <命令>`（或在 install 后用 `kunpeng <命令>`）。

## 命令一览

所有命令默认作用于「目标项目仓库」（你要桥接的真项目），由 `--repo <路径>` 或 `KUNPENG_REPO` 或当前目录决定。

| 命令 | 作用 | 关键 flag |
|---|---|---|
| `run "<需求>"` | 受理一个需求，跑完整开发循环（spec → 测试审计 → 单写者实现 → 差分验证 → 提交 `kp/<flow>` 分支）。验证用目标库真实 `typecheck`。验证通过 exit 0，否则 exit 2。 | `--repo`、`--accept "<精确验收命令>"` |
| `register` | 把目标仓库登记进中央注册表（`projects.json`）并写 repo 自描 `.kunpeng/project.json`。幂等。 | `--repo`、`--name <展示名>` |
| `projects` | 列出中央注册表里已注册的全部项目（id ｜ 名 ｜ 路径）。 | — |
| `onboard` | 渲染并打印某项目的接管声明（源自单一模板 `onboard.tmpl.md`）。项目未注册则 `exit(1)`。 | `--repo` |
| `compile` | 把鲲鹏宪法 stamp 进目标仓库的 `AGENTS.md`。**非覆盖**：目标已有自己的 `AGENTS.md` 时改写到 `.kunpeng/`。 | `--repo` |
| `guard` | 只读体检：用目标库真实 `typecheck`(error) / `lint`(warn) 当扫描器，外加 TODO 扫描，结果存为 review 产物。 | `--repo` |
| `evolve` | 消费经验产物，生成自我进化提案（仅改 conventions，命中 core 的一律拒）。**只提案不应用**，需人工门 #2。 | `--repo` |
| `release "<build command>"` | 跑构建命令，成功记为发布就绪、失败记为 rolled-back，结果存为 release 产物。成功 exit 0，否则 exit 2。 | `--repo` |
| `doc` | 把产物库编译成文档索引，写到目标库 `.kunpeng/DOCS.md`。 | `--repo` |
| `serve [port]` | 启运营总控台 HTTP（默认端口 7777，进程常驻）。给 `--repo`/`KUNPENG_REPO` → 单项目模式；否则读中央注册表聚合全部项目。红绿灯 / agent@阶段 / ETA / 卡点 / 人工门一键操作。 | `--repo`、位置参数 `port` |

## 环境变量

| 变量 | 含义 | 默认 |
|---|---|---|
| `KUNPENG_HOME` | **宪法/角色卡来源**（编译 `AGENTS.md` 的源），只读，与目标仓库解耦。 | 安装目录上层（`dist/..` 的上一级） |
| `KUNPENG_REPO` | 默认**目标项目仓库**路径。 | 当前目录 |
| `KUNPENG_STATE` | 跨项目**运行时状态目录**（中央注册表 `projects.json` 所在）。与只读的 `KUNPENG_HOME` 解耦。 | `~/.kunpeng/` |
| `KUNPENG_BACKEND` | 子 agent 后端：`claude`(默认) / `codex`，均用登录态 CLI、零 API key。 | `claude` |

## 架构速览（`src/` 下各模块职责）

- `cli.ts` — CLI 入口与命令分发；`makeFlowId` 把需求转成 flow id。
- `artifacts/` — 标准产物层（C2）。`store.ts` 落盘读写，`types.ts` 用 zod 定义 kind（spec/plan/task/review/experience/proposal/release）与状态机 `TRANSITIONS`。
- `git/workspace.ts` — 单写者工作区，按 flow 分配/释放隔离的 git worktree。
- `agent/` — 子 agent 后端。`cli-runner.ts` 起登录态 CLI（claude/codex），带超时硬保护；`runner.ts` 定义 `AgentRunner` 接口。
- `loop/dev-cycle.ts` — 主开发循环（spec → 审计 → 实现 → 验证 → 提交）的确定性状态机。
- `loop/audit.ts` — 测试审计：确定性闸门，拦弱测试（只查存在/恒真的验收命令），堵 C3 残留风险。
- `loop/guardian.ts` — 守护扫描器，确定性 shell 扫描（typecheck/lint/TODO）。
- `loop/self-evolution.ts` — 自我进化：消费经验产出提案，只改 conventions、命中 core 即拒（C6）。
- `loop/build-release.ts` — 构建发布执行与结果归档。
- `verify/gate.ts` — 验证门，跑验证命令并算 `newFailures`（差分验证：实现前抓基线、实现后对比，只拦新错）。
- `runtime/flowstate.ts` — 流状态打点（阶段、人工门），供总控台读。
- `compile/agents-md.ts` — 把宪法编译成 `AGENTS.md`，幂等、非覆盖别人的文件。
- `compile/docs.ts` — 把产物库编译成文档索引。
- `project/detect.ts` — 探测目标项目真实的 `typecheck/lint/build` 脚本。
- `project/registry.ts` — 项目身份层：中央注册表 + repo 自描，原子写 + 形状校验。
- `project/onboard.ts` — 接管声明模板渲染（`{{name}}`，纯函数）。
- `server/` — 总控台。`state.ts` 采集（单项目 `collectState` + 多项目 `collectMultiState`）、`page.ts` HTML、`http.ts` server + 人工门回写；`dashboard.ts` 为 barrel 保旧 import 不破。
- `index.ts` — public API surface（programmatic 嵌入入口）。未在此再导出的模块一律视为 internal。

## 多项目总控台

从「单库后台」走向「数字研发团队 org」——一个鲲鹏统一总控多个纳管项目。典型工作流：

```bash
# 1) 登记目标项目（中央表 + repo 自描双写，幂等）
kunpeng register --repo <目标仓库> --name "<展示名>"

# 2) 看已纳管的全部项目
kunpeng projects

# 3) 渲染该项目的接管声明（贴进目标库供其 agent 阅读）
kunpeng onboard --repo <目标仓库>

# 4) 起总控台：不带 --repo → 聚合注册表里全部项目
kunpeng serve 7788
```

人工门按 `projectId` 隔离回写：合并/批准动作携带 projectId，server 据此定位 repo，绝不串项目。给 `--repo` 时退回单项目模式（向后兼容）。

## 边界（绝不做的事）

- **三道人工门永不自动越过**：合并主干、改宪法、对外发布——必须人类确认（C5）。
- **不覆盖目标库配置**：目标已有的 `AGENTS.md` / `CLAUDE.md` 不动，鲲鹏自己的规矩写到 `.kunpeng/`。子 agent 反过来继承并遵守目标库现有配置。
- **不夺外部 agent 工作树**：合并用临时 worktree，绝不在共享工作树上 `git checkout` 切分支。冲突即中止并归人工门，不强行合并。
- 未经人工确认，不改代码、不合主干、不推远端、不部署。

## 延伸阅读

- [`../docs/GOVERNANCE.md`](../docs/GOVERNANCE.md) — 面向所有 agent 的全局治理与接管协议（分工、统一工作流、人工门、边界）。
- [`../constitution/core.md`](../constitution/core.md) — 宪法不可变核心 C1–C9。
- [`../constitution/conventions.md`](../constitution/conventions.md) — 可由自我进化提案修改的约定。
- [`../docs/JOURNAL.md`](../docs/JOURNAL.md) — 工程日志（里程碑历史）。
- [`../docs/SESSION-HANDOFF-2026-06-14.md`](../docs/SESSION-HANDOFF-2026-06-14.md) — 跨对话交接包（当前状态 + 下一步）。
- [`../CHANGELOG.md`](../CHANGELOG.md) — 变更记录（Keep a Changelog）。
