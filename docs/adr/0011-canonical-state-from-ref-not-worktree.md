# 0011 · 规范代码状态读 git ref，不读工作树（工作树是便利镜像）

**Status**: Accepted（2026-06-27）；「工作树停在 work 分支 + sync-work 追平」部分 Superseded by [ADR-0014](0014-main-checkout-worktree-and-runtime-mirrors.md)（2026-09-24），「规范代码状态读 git ref」原则继续有效

关联：复用 [0009](0009-plan-integration-branch-not-main.md)（集成分支不碰 main、main 由 safeMerge 原子推进）。

## Context（反复出现的坑）

`~/kunpeng`（注册的项目 repoRoot，被 cockpit 仪表/工具读）的工作树**故意停在 `work` 分支**：后台多个 loop 用 `update-ref` 原子推进 `main` 引用（各自 worktree 里），若 `~/kunpeng` 检在 `main` 上，别处推进 main 会打乱这棵活树的视图（shared-worktree HEAD collision）。所以 `work` 是后台不碰的稳定分支——**代价是它落后 main**。

后果：任何把"工作树文件系统"当"规范代码状态"来读的消费者，都会看旧码。已亲历多次：
- 代码行数/过审行数仪表数旧树（`passedLines` 自称"已合入 main"却数工作树）；
- 验证脚本读 `~/kunpeng/src` 误判功能"没生效"（实则在 main 上）。

补丁式做法（定时把 work 追平 main）治标不治本：有时间窗、要处理脏树/冲突、定时器本身会挂——正确性仍依赖"树够新"。

## Decision

**规范代码状态的真相源 = `main` git ref，不是工作树文件系统。工作树降级为"便利镜像"。**

1. **单一读路径**：读"规范代码"（行数/文件清单/文件内容做指标或判定）一律走 git ref（`git grep -c` / `ls-tree` / `show <ref>:<path>`），封装在 `orchestrator/src/status/loc-ref.ts` 一类 helper 里。已落地：`countLinesFromRef` + `countSrcTest` 从 `main` ref 数（非 git/无匹配回退文件系统兼容他仓）。
2. **正确性免疫漂移**：消费者读 ref → 工作树漂不漂、定时器挂没挂，都不影响读数对。
3. **工作树 = 便利镜像，定时器非承重**：`com.kunpeng.sync-work`（每 5 分钟 FF work→main）只为"人打开 `~/kunpeng` 看到当前码"的体验；**它失败不影响任何规范读数的正确性**。
4. **防回归**：guard 测试断言 LOC 走 ref（退回纯文件系统读即红）；conventions 固化"规范代码读 ref 不读工作树"，agent/人新增指标必须走 helper。

## Consequences

- 正负向都明确：规范读数恒等于"已合入 main"，与开发树状态解耦；新增 tree-dependent 指标若直接 `readdir(repoRoot)` 读源码会被 conventions/guard 拦。
- 例外（可接受读工作树）：纯"浏览当前检出"的便利功能（文件浏览器 file-serve）可读工作树，但**不得**作为正确性判定/指标来源；需要规范口径时走 ref。
- 定时器是 ergonomics，不是 correctness；可随时停用而不破坏读数。
