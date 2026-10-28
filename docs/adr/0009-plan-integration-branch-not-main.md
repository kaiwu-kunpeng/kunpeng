# 0009 · plan 集成分支不碰 main

**Status**: Accepted（2026-06-14）

## Context

`kunpeng plan <方案.md>` 把一份外部方案分解成按阶段分组的多条 flow：**段内并行、段间顺序**。段间顺序意味着后段要看得到前段的产出（有依赖），所以前段产物得先「集成」到某处，后段的 worktree 才能 off 它分叉。

但「集成」天然想往 `main` 上合——而合并到 main 是三道人工门之一（C5 / ADR 0004），永不自动越过。如果段间集成自动合 main，就破了三道门；如果每段完成都挂一道「合并主干」人工门，那一份多段方案会在中途堆出一串门，人要点很多次、自动化形同虚设。需要一个既满足顺序依赖、又不破 C5 的集成位置。

## Decision

每份 plan 用**自己的集成分支** `kp/plan-<planId>`，段间自动集成合进这条分支，**绝不碰 main**：

1. 开 `kp/plan-<planId>`，初始 = `main`（或当前 HEAD）。
2. `phase 0` 的 flow off `main`；`phase k>0` 的 flow off `kp/plan-<planId>`——后段因此看得到前段已集成的产出，满足顺序依赖。
3. 段内所有 flow 全 `verified` 后，用 `safeMerge`（临时 worktree 安全合并，复用 Block-1 验证过的逻辑，绝不在共享工作树 `checkout`）把各 `kp/<flowId>` 串行合进集成分支。
4. **失败即停段**（fail-closed）：段内任一 flow 回滚 → 该段失败、不启动后续段、整盘停、记卡点产 experience。不在坏地基上继续盖。
5. **终点单门**：全部段 verified 后，整条 `kp/plan-<planId>` 才挂唯一一道「合并主干」人工门（`kp/plan-<planId> → main`），绝不自动合 main。

**保门论证**：阶段间的自动集成是**合进 plan 自己的分支、不是 main**，故不属于三道门里的「合并到主干」，不算门——符合「三道门、其余全自动」。只有整条 plan → main 这一步才是人工门 #1。

## Consequences

- **换来**：段间顺序依赖被满足（后段见前段产出），同时把「合并主干」收敛成**唯一终点门**，既不破 C5 也不让人点一串门；失败停段避免在错误地基上累积。
- **成本**：每份 plan 多一条集成分支要管理（创建/合并/最终清理）；段间集成失败/冲突要中止挂人工门（延续 COORDINATION 不强合）；段化执行引擎（`plan/orchestrator.ts` `runPlan` + `runPool` 并发池）比单条 flow 复杂。
- **关联**：依赖 ADR 0001（worktree 隔离、不夺共享工作树）、0004（三道门不变）、0003+0005（每条 flow 仍走测试审计 + 差分验证）。
