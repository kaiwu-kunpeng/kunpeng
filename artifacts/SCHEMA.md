# 产物 Schema 与状态机

所有产物是 markdown + YAML frontmatter，落盘在项目的 `.kunpeng/artifacts/` 下。**产物即真相**（宪法 C2）。

## 状态机
```
draft ──approve──▶ approved ──pickup──▶ in-progress ──verify──▶ verified
  │                                          │
  └──────────────── rolled-back ◀────────────┘   (任一步出错可回滚, C4)
```
- `verified` 是唯一可声明"完成"的状态，且必须附验证证据（C3）。
- 合并主干前，关联 spec 必须 `verified` 且过人工门（C5#1）。

## 五类产物

### spec（需求规格）— Living spec
`status, owner, requirement, acceptance_criteria[], non_goals[]`
实现偏离时由 implementer 回写，保持真相源不腐化。

### plan（实现计划）
`status, spec_ref, steps[], risks[], rollback_plan`

### task（可执行任务）
`status, plan_ref, assignee_role, files_touched[], writes_code`
单写者：同一 task 的 `writes_code:true` 同时只能有一个活跃实例。

### review（评审/审查发现）
`status, target_ref, findings[]{severity, file, line, claim, evidence}`
来自 评审/代码治理/测试审计——**只产出 findings，不改代码**（C1）。

### experience（经验）— 喂自我进化
`source_group, context, lesson, proposed_rule_change?`
入库须验真（C6）。自我进化消费它，产出对 conventions/角色卡 的"提案"。
