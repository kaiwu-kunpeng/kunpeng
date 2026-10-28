# 0012 · 自进化升级为「真适应度驱动的统一改进层」

**Status**: Accepted（2026-06-27，用户评审已定盘）

关联：演进自 [0010](0010-self-evolution-as-sensing-and-audit.md)（四通道感知+审计，保留其定位，不废止）；强约束于 [0004](0004-three-human-gates.md)（三道人工门）；复用 [0003](0003-unforgeable-verification-test-audit.md)（验证不可造假）、[0005](0005-differential-verification.md)（差分验证）作为测试门；与 [0006](0006-determinism-over-llm.md)（确定性优先）同源（裁判/监工只读、gate 落执行）。

## Context

[0010](0010-self-evolution-as-sensing-and-audit.md) 在「系统 ≈ 一条自建 loop + 一份 conventions」时代把自进化重定义为「眼睛/耳朵/守门员」，并已建成 `kunpeng maintain`（三通道：安全/模块/耳朵）、真差分评测 harness、S5 漏洞闭环。

但半年内架构长成 14 子系统的研发底座，自进化最该消费的新信号**完全没接进回路**（已用 grep 核实）：

- **G1 假适应度**：`evolution/` 零引用 `time-saved`/`savings`/`cost-report`/`LoopStore`。进化用合成 `holdoutPassK` 判好坏，对真实净省工时（North Star，只认 verified dev flow、天然难 game）与成本完全失明。
- **G2 测试门旁路**：`maintenance-scan.ts` 把 findings 直接写 `draft` proposal，未调用 `eval-runner`/`evaluateProposal`——0010 当核心的「小规模测试门」不在主路上。
- **G3 记忆不复利**：ears 啃原始失败产物；LoopStore wave / KB capture 皆 append-only，无蒸馏、无 ADD/UPDATE/DELETE 调和、无 k≈1 召回、无衰减。
- **G4 进化目标碎片化**：`design-memory.ts`（winRate 环）与 product validate（pivot/persevere 环）是同构自改进环，却各自为政，无统一抽象。
- **G5 提案一次性**：`buildProposal` 从 experience 字段一次性产出，无轨迹反思、无 Pareto 多样性、无按模型版本重优化（Opus 升级后 conventions 会 rot）。
- **G6 桥薄**：proposal→人工门#2→自建 spec 手工，0010 自评的「人工门黑洞」未解。

两路外部研究（Web SOTA 12 原则 + GitHub 7 模式，2024–2026）独立收敛出一条硬事实：**能被证明真在自我改进的系统都 gate 在便宜、外部、自动、难 game 的真实信号上**；任何建在「学习出的裁判」上的环，agent 最终都会 game 它（DGM 删自己的幻觉检测标记、伪造测试日志；reward-hacking 会因果泛化成广义不对齐）。且**自我改进的都是脚手架不是权重**——鲲鹏「只改软资产、不无监督改 core」正落在唯一被证明 work 的那层。鲲鹏明明已有 North Star（真适应度）却没接，是这轮升级的根本缺口。

## Decision

把自进化从「产 conventions 提案的感知守护进程」升级为「**系统统一的、由真实适应度驱动的改进层**」，三支柱：

1. **真适应度**：新建 `EvolutionFitness`，把 `metrics/time-saved`（净省工时，只认 verified dev flow）+ `runtime/cost-report` 喂成 fitness。一个改动算「变强」必须在**真实结果信号**上 Δ>0 且成本不恶化，**且不退化任何未瞄准指标**（非回归门）。合成 `holdoutPassK` 退为辅助信号。
2. **复利记忆**：LoopStore wave + 失败 → 蒸馏「已验证、可复用」单元；Mem0 式 ADD/UPDATE/DELETE/NOOP 调和（停止 append-only）；k≈1 高精度召回；衰减 + 双时态 provenance（Graphiti 思路）。
3. **多目标进化 + 档案/晋升图**：进化对象从「只 conventions」扩到 conventions/角色卡/prompt/skill；建变体档案+谱系（DGM/ADAS）；**收编** design winRate 环与 product validate 环到统一进化抽象（用户已定盘纳入）；晋升只经门 + 人工门（ASG-SI 结构）。

硬约束（守 0010 四约束 + 研究 12 原则）：

- **进化脚手架，永不无监督改 core / 奖励逻辑 / 门本身**：只走人工门 #2。
- **不变量靠机制不靠 prompt**：宪法 core 落确定性门 + 只读/签名文件，在 agent 写权限之外。
- **作者永不评/测自己的改动**：proposer 与 verifier 分离；harness 锁死、当攻击面、holdout 定期轮换、并定期审自己的测试（59% 假失败教训）。
- **永不把学习出的打分器/CoT 监工当优化目标**：只当只读触发器/便宜分诊，gate 落执行。
- **目标带对齐项 + 非回归门**；**provenance + 一键可逆 + 灰度熔断**；**每轮重注入不变量**；**conventions 按模型版本 scope，晋升查 train-holdout gap**。

落地分 6 段（E0→E5），每段一个或多个自建 spec、晋升处停人工门 #2：

| 段 | 治 | 核心 |
|---|---|---|
| E0 真适应度+关测试门 | G1,G2 | EvolutionFitness 接 time-saved+cost；eval 门接进 maintain；evidence 喂真实 Δ |
| E1 复利记忆驱动器 | G3 | LoopStore+失败→蒸馏；调和；k≈1；衰减+provenance |
| E2 反思式 convention 优化器 | G5 | 读真实 flow 轨迹→根因→定向改；Pareto；按模型版本 scope（GEPA） |
| E3 统一进化档案+收编 | G4 | 变体档案+谱系；收编 design/product 环；多样化父代再选 |
| E4 守门员强化 | 原则3/4/5 | 独立 trusted 监工只读触发器；harness 锁+只读签名不变量 |
| E5 通道补全+桥 | G6 | 通道 B（官方源）；提案→人工门→自建 spec 自动桥 |

## Consequences

- **换来**：自进化从「合成分驱动的窄提案器」变成「真实结果驱动的统一改进层」——用难 game 的净省工时当适应度，经验复利，散落的改进环归一，决策权仍在人手里，符合业界与官方都认可的 supervised 范式。
- **成本**：EvolutionFitness 需稳定的 flow 历史/成本归因；复利记忆的蒸馏/调和消耗 LLM 调用（要打得过「多跑几步」token 基线）；收编 design/product 环需重构其私有 winRate/validate 存储到统一档案。
- **约束**：守 [0004](0004-three-human-gates.md) 三门不变；任何自提改动即便过测试门也不得自动落 main/改 core；安全审计发现按不可逆动作处理（只报不自动修，S5 修复闭环除外且隔离验证）。
