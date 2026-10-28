# 架构决策记录（ADR）

> Architecture Decision Records——鲲鹏的关键架构/治理决策档案。

## 什么是 ADR

一篇 ADR 记录**一个**决策：是什么触发了它（Context）、我们选了什么（Decision）、由此付出与换来什么（Consequences）。

规则：

- **一篇一决策**，1–2 页，写「为什么这么定」而非操作手册。
- **不可变（immutable）**：决策一旦 Accepted 就不再改写原文。要变更就**新写一篇并标 supersedes / superseded-by**，旧篇保留作历史；不在原 ADR 上覆盖编辑。
- 文件名 `NNNN-kebab-title.md`，编号零填充、只增不复用。

本批 ADR 是对鲲鹏既有真实决策的**反向补录（backfill）**：决策本身早在 2026-06-13/14 落地（见 `constitution/core.md` 的 C1–C9 与 `docs/JOURNAL.md` 的里程碑），此处把它们编号归档，便于审查、引用与防止隐性回退。属 Block-D 整改清单 #5「决策记录 ADR 化」。

## 索引

| ADR | 决策 | 关联 | 状态 |
|---|---|---|---|
| [0001](0001-single-writer-worktree-isolation.md) | 单写者 + worktree 隔离 | C1 | Accepted |
| [0002](0002-artifacts-as-truth.md) | 制品即真相（五类产物 + 状态机） | C2 | Accepted |
| [0003](0003-unforgeable-verification-test-audit.md) | 验证不可造假 + 弱测试审计 | C3 | Accepted |
| [0004](0004-three-human-gates.md) | 三道人工门（其余全自动） | C5 | Accepted |
| [0005](0005-differential-verification.md) | 差分验证（只拦基线之外的新错） | — | Accepted |
| [0006](0006-determinism-over-llm.md) | 确定性优先于 LLM | C8 | Accepted |
| [0007](0007-logged-in-cli-zero-api-key.md) | 登录态 CLI、零 API key | — | Accepted |
| [0008](0008-lead-plus-ondemand-subagents.md) | 主 + 按需子 agent，不养固定编制 | C9 | Accepted |
| [0009](0009-plan-integration-branch-not-main.md) | plan 集成分支不碰 main | Block-A | Accepted |
| [0010](0010-self-evolution-as-sensing-and-audit.md) | 自进化重定义为四通道感知+审计（眼睛/耳朵/守门员） | C5 | Accepted |
| [0011](0011-canonical-state-from-ref-not-worktree.md) | 规范代码状态读 git ref，不读工作树 | — | Accepted（work 分支部分被 0014 取代） |
| [0012](0012-self-evolution-fitness-driven.md) | 自进化升级为真适应度驱动的统一改进层 | C6 | Accepted |
| [0013](0013-taskboard-agent-teams-shape.md) | 跨实例可认领任务队列（按 Agent Teams 数据面重做） | C9 | Accepted |
| [0014](0014-main-checkout-worktree-and-runtime-mirrors.md) | `~/kunpeng` 跟 main；运行代码只认 serve/cron 镜像 | — | Accepted |
| [0015](0015-container-exec-strategy.md) | 容器执行后端先做可选机制，验收进容器等运行时与依赖策略就绪 | C3 | Accepted |

> 后续若有决策推翻上述任一篇，新增 `00NN-*.md` 并在两篇互标 supersedes/superseded-by，不改旧篇。
