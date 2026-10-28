# 鲲鹏技能库（skills/）

> 方向5（经验→技能库）的起点。采开放 **SKILL.md 格式**（渐进披露：名+触发描述做索引，**为将来的自动匹配载入/按需执行预留**——当前 orchestrator 尚无 skill loader，技能靠主 agent 手动读取）。技能是**抬高子 agent 首遍质量的输入**，不是替代鲲鹏的确定性门——纪律仍由代码强制（宪法 C1/C3/C8），技能只把「好实践」喂给子 agent。

## 来源与许可

部分技能改编自 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)（作者 Addy Osmani，Google Gemini/Chrome 工程总监），**MIT License**，commit `a5f0b17`。MIT 允许复制/改编/再分发，唯一义务=保留版权与许可声明（见同目录 `LICENSE.addyosmani-agent-skills.txt`）。本库对引入技能**一律标注 `source:` 出处**，且按下述原则改编而非照抄。

## 改编原则（不照抄的理由）

1. **去掉悬空引用**：上游技能引用 Claude Code 的 `personas/`、`references/orchestration-patterns.md`、`agents/` 等，鲲鹏无对应物，全部重写为鲲鹏现实（子 agent 派发、roster 角色、`KUNPENG_BACKEND` 多后端）。
2. **对齐宪法**：映射到 C1-C9，标明该技能强化哪条门。
3. **只取增量纪律**：鲲鹏的状态机/验证门已**用代码物理强制** TDD、单写者、验证不可伪造、增量实现等——这些**不进口为技能**（进口=cargo cult）。只进口鲲鹏尚未强制的增量纪律。

## 选型台账（addyosmani/agent-skills 24 技能 → 鲲鹏）

| 处置 | 技能 | 理由 |
|---|---|---|
| ✅ 已集成 | `doubt-driven-development` | 形式化鲲鹏「合并后必对抗审查/走真实串线」（接方向3）；当前手动做、未固化 |
| ⏳ 待集成（增强 roster） | `code-review-and-quality`、`security-and-hardening`、`code-simplification` | 五轴审查 / 三层边界(方向4) / Chesterton 栅栏(清理批次) |
| 🔭 未来·前端轨 | `frontend-ui-engineering`、`browser-testing-with-devtools`、`performance-optimization` | 接 tier-gate 空门（a11y/perf/visual）；Chrome DevTools MCP 已配 |
| 🔭 未来·产品轨 | `interview-me`、`idea-refine` | 强化 DEFINE 阶段（当前 spec 工位偏机械） |
| ⛔ 不进口 | `test-driven-development`、`incremental-implementation`、`planning-and-task-breakdown`、`git-workflow-and-versioning`、（其余 ship/ci 类） | 鲲鹏已用代码强制或暂不需要 |

## 已集成技能

- [`doubt-driven-development/`](doubt-driven-development/SKILL.md) — 对每个非平凡决策做新上下文对抗审查（证伪式），合并/落地前生效。
- [`seo-audit/`](seo-audit/SKILL.md) — 网站 SEO 与 AI 可见性审计（出具方开悟科技）：全站抓取、多语言、速度、各国 Google 实查排名、AI 概览引用、外链与各国自然搜索、多引擎 AI 推荐与介绍准确性、竞品对照，按固定检查项评分，语言与逻辑两路独立审查、净化扫描后发布公开短链；诊断与方案两种模式，默认只诊断。
