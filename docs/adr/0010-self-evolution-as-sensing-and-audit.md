# 0010 · 自进化重定义为「四通道感知 + 审计」常驻（眼睛 / 耳朵 / 守门员）

**Status**: Accepted（2026-06-21，评审决策已并入下文）

关联：supersedes 无（修正既有自进化模块的定位，不废止任何已 Accepted ADR）；强约束于 [0004](0004-three-human-gates.md)（三道人工门）；复用 [0003](0003-unforgeable-verification-test-audit.md)（验证不可造假）、[0005](0005-differential-verification.md)（差分验证）作为「小规模测试门」。

## Context

既有自进化模块（`evolution/`、`loop/patrol.ts`、`loop/self-evolution.ts`、`feedback/`）在「让系统从经验中学习、自动提改进」这个目标上**架构齐全但流程不通**。按「自动改代码」这把尺子量，约 80% 在空转：

- `autopilot.ts` 硬码 `含 upgrade 类改动,保留人工审` → 任何升级类提案永不自动执行（半年 0 条）；
- 人工门 #2 成黑洞：3 个 `approved` 提案永久卡住，无推进 / 超时 / 提醒；
- `eval-replay` 回放失败被 `catch{}` 吞，evidence 只用于 UI 展示，apply 路径从不消费 → 假反馈回路；
- `feedback/flywheel` backlog 287 条、266 pending、仅 1 consumed → 驱动器没有调用点；
- `scout` 产出 `<repo>/.kunpeng/suggestions.md` 无人消费、非定时、无社区（X）通道。

两条外部证据解释了这不是偶然：① 业界「自我改进」只在**结果机器可验证**（测试过/分数升）的窄口成立，全自动递归改代码 2–3 轮即撞墙，且 DGM 等实测会**伪造测试日志、删检测标记**来 game 自己；② 商业产品（Claude/Codex 官方）出于担责与可信，**刻意不提供全自动自进化**，OpenAI 唯一正面材料的结论是 "Supervised Autonomy"——eval 当闸 + 人批 prompt + 有界。

但同一批证据也指明：**感知（scout）、结构化经验库、安全审计是真正 work 且高价值的部分**。用户由此重定义需求：自进化不是「自动改自己」，而是**系统的眼睛、耳朵、守门员**——定时感知外部世界与自身、产出升级方向与小规模测试结果，喂回人工门由人决策。

## Decision

把自进化模块的职责从「自动应用引擎」**重定义为「四通道定时感知 + 审计常驻」**，统一产出 `proposal`（升级方向 + 证据 + 小规模测试结果），经既有 eval 门过滤后落 cockpit 与人工门 #2，由人决定是否走自建 loop 实施。

四条通道（均 cron 定时，产物统一进 `proposal` store）：

1. **耳朵 · 经验 → 联网找方向**：`failure-digest`/`learnings` 蒸馏开发经验教训 → 据此**联网（GitHub/Web）搜相关项目与解法** → 出升级方向。打通现有半成品（researcher 目前只有桩）。
2. **眼睛 · 官方**：定时扫 Claude / Codex 官方更新（docs / changelog / 工程博客）→ 出升级方向。（**X 社区通道本期不做**，作为后续增量，因抓取额度与稳定性不确定。）
3. **眼睛 · 逐模块升级 + 知识库复盘**：按 `status/module-registry` 逐模块每日找升级方向，并回读知识库看有无更好方案。
4. **守门员 · 安全审计**：定时对全系统做安全审计（复用 `/security-review` 能力）→ 出风险清单。

四条硬约束：

- **不自动改代码**：通道只产出「方向 / 提案 / 风险」，绝不自动 apply 到代码。**删除 `autopilot` 的 upgrade 自动应用死路径**（`conventions` 的人工应用保留；未接线的 `feedback/flywheel` backlog 留作单独议题，本期不动）。这与 [0004](0004-three-human-gates.md) 的 C5#2「自我进化的固化必须人点头」完全同源。
- **小规模测试门**：任何「方向」要升为可信提案，先在隔离 worktree 跑小规模验证（复用 `evolution/eval-*` + `candidate-sandbox`），不涨分 / 退化即降级标注，验证不可造假（[0003](0003-unforgeable-verification-test-audit.md)）。**无法跑测试的方向类**（如「升级某库」）走轻证据 = 来源 + 影响面分析，并**明确标注未经测试**。
- **每日所有发现进知识库**：四通道每天产出的内容（含未过测试门的降级项）一律 `kunpeng capture` 落知识库，作为原始研究素材——既不丢，又被「通道 3 知识库复盘」回读形成飞轮。
- **产出必被消费 + 限流**：每条通道产物有落点（cockpit 自进化页 + onboard 注入 + 人工门），带去重 / 排序，**每通道每日只推 top-3 进人工门**，避免 proposal 洪水与 `suggestions.md` 那样的死信。

## Consequences

- **换来**：自进化从空转变成真闭环——系统每天自动感知外部新方向、自身模块短板、安全风险，并把经验教训转成可执行的升级方向；价值落在「自动化掉重复的、可验证的发现」，决策权仍在人手里，符合业界与官方都认可的 supervised 范式。
- **成本**：① 联网 / X 抓取消耗额度（xcrawl 账号级共享，需限流，见运维约定）；② 多条 cron 的运维（launchd 排程、失败告警转人工）；③ proposal 数量上升，去重 / 优先级排序成为必需基建，否则人工门被淹。
- **约束**：守 [0004](0004-three-human-gates.md) 三门不变（合并主干 / 改宪法角色卡 / 对外发布仍人点）；通道产物即便通过小规模测试也不得自动落 main；安全审计发现的可利用项按不可逆动作处理，只报不自动修。
