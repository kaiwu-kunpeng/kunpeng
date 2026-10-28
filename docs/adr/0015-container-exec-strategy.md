# 0015 · 容器执行后端：先做可选机制，验收进容器等运行时与依赖策略就绪

**Status**: Accepted（2026-09-24）

## Context（2026-09-24 本机实测，colima + Docker 29.5.2）

- 执行后端第一刀已做成可选机制：`.kunpeng/flow-options.json` 配 `execBackend: { kind: "docker", image }` 后，agent 进程跑在本机容器里（worktree 同路径挂载、宿主 uid:gid、环境变量只传名字）。缺省仍是本机执行。
- 想把**验收命令**（tsc / vitest / lint）也搬进容器时，实测撞到三件事：
  1. **colima 文件共享不稳定**：同一个仓库路径，前后两次挂载看到的内容不同（一次 162 个包、一次为空）；直接挂 `~/kunpeng/orchestrator` 这一层看到空目录。系统临时目录则完全不共享——容器里写成功、宿主上静默丢失（第一刀已为此加了「cwd 必须在共享根下」的 fail-closed 检查）。
  2. **依赖平台不符**：`node_modules` 在 macOS 上安装，esbuild / rollup 等原生二进制在 Linux 容器里不可用。
  3. **HOME 不可写**：以宿主 uid 运行时容器内 HOME 为 `/`，npm / npx 需要显式可写 HOME。
- 在这种环境下做「验收进容器」，验收结果本身不可信，违背宪法 C3（验证不可伪造）。

## Decision

1. **第一刀保持为可选机制，缺省关闭**；不在鲲鹏本仓启用 `execBackend`。
2. **验收进容器暂不实现**，恢复条件（同时满足）：
   - 容器运行时的宿主目录共享经 20 次连续挂载校验一致（候选：OrbStack、Docker Desktop 的 VirtioFS；或 Linux 宿主）；
   - 依赖策略落定：**镜像自带工具链 + 容器内 `npm ci` 到命名卷 + 源码复制进容器（不绑定挂载活仓库）**，容器内 HOME 指向可写目录；
   - 验收结果与宿主执行对照一致（同一流、同一 commit，宿主 vs 容器的 pass/fail 在 ≥10 条流上完全一致）。
3. 条件满足后按「runVerification 增加可选执行后端 → 仅在 flow-options 显式开启的项目生效」的顺序接入，仍走 loop。

## Consequences

- 不会因为不可靠的文件共享得到假绿或假红的验收。
- 代价：容器隔离目前只覆盖 agent 进程本身；测试和检查仍在宿主上跑，由 codex `--sandbox workspace-write` 与合并门兜底。
- 交付场景（Linux 服务器上以 Dockerfile 部署鲲鹏本体）不受此限制，可在那里先验证恢复条件。
