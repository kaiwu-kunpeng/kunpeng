# 0014 · `~/kunpeng` 工作树跟 main；运行代码只认 serve / cron 两个镜像

**Status**: Accepted（2026-09-24）。部分取代 [0011](0011-canonical-state-from-ref-not-worktree.md)：0011 的「规范代码状态读 git ref」原则继续有效；「`~/kunpeng` 停在 `work` 分支、由 `com.kunpeng.sync-work` 追平」这一部分作废。

## Context（2026-09-24 审计实测）

- `~/kunpeng` 实际检出在 `main`，`work` 分支已不存在；autopilot 与 `kunpeng merge` 直接在这棵树上把 verified 流合进 main 并推送。
- `com.kunpeng.sync-work` 的脚本第一行判断 `HEAD = work`，不成立就退出：它已空跑 7,297 次，什么也没做。
- `~/kunpeng/orchestrator/dist` 只在 `kunpeng merge` 时重建（合并后自动 build + 冒烟）；autopilot 合并不重建它，所以它经常落后 main 几个合并。
- 真正在跑的代码来自两个 detached 镜像：`~/kunpeng-serve`（驾驶舱 serve，由 sync-serve 在无在跑流时追平 main、重建、重启）与 `~/kunpeng-cron`（cron / 派流用的 CLI，由 sync-cron 追平并重建）。

## Decision

1. **`~/kunpeng` 工作树就是 main 的检出**，是合并与写 spec / 文档的地方；不再维持 `work` 分支拓扑。
2. **运行代码只认两个镜像**：派流、定时任务、临时 CLI 调用一律用 `~/kunpeng-cron/orchestrator/dist/cli.js`；驾驶舱用 `~/kunpeng-serve`。**不要从 `~/kunpeng/orchestrator/dist` 跑命令**——它不保证与 main 同步。
3. **规范代码状态仍读 git ref**（0011 原则不变）：指标、正确性判定走 `main` ref，不读任何工作树。
4. **停用 `com.kunpeng.sync-work`**（2026-09-24 已 `launchctl bootout`；plist 文件保留，需要时可 `launchctl bootstrap` 恢复）。

## Consequences

- 少一个空跑的定时器；「改动消失 / dist 落后」一类困惑有了明确答案：看镜像，不看 `~/kunpeng/dist`。
- 风险：有人习惯性用 `~/kunpeng/orchestrator/dist/cli.js` 派流，会跑旧编排器。缓解：派流脚本与文档统一写 `~/kunpeng-cron` 路径；记忆 `kunpeng-main-dist-not-auto-rebuilt` 同步更新。
- 若将来要让 `~/kunpeng/dist` 也可信，可在 autopilot 合并后追加一次 build（不在本决定范围）。
