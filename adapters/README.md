# 适配层

把核心资产（constitution/roster/artifacts/loops）编译到各工具。核心不绑工具，边缘才碰工具。

- `agents-md/` → 编译产出根 `AGENTS.md`（跨工具真相源，首选）
- `claude-code/` → subagent(各组) + skill(流程) + command(触发) + cron(守护/进化)
- `cursor/` → rules + 就近 AGENTS.md

编译方向单向：源(core资产) → 适配产物。改行为改源后重编译，不手改产物。
