import type { ProposedChange } from "../loop/self-evolution.js";
import type { AgentRunner } from "../agent/runner.js";

/** 把一批升级提案交给后端 LLM，翻成一份 `kunpeng plan` 可解析的 `方案.md`（纯透传，不二次加工）。 */
export async function draftPlanFromUpgrades(
  upgrades: ProposedChange[],
  runner: AgentRunner,
): Promise<string> {
  const enumerated = upgrades
    .map((u, i) => `### 升级 ${i + 1}\n- 内容：${u.text}\n- 来源：${u.source}`)
    .join("\n\n");

  const input = [
    "把下面这批「升级提案」翻译成一份带验收的 `方案.md`。",
    "",
    "## 升级提案",
    enumerated,
    "",
    "## 输出要求",
    "- 结构参照本仓库 `docs/proposals/` 既有方案：H1 标题 / H2 阶段 / H3 flow。",
    "- 每个 flow 配一个 `kunpeng plan` 能解析的验收围栏块（```accept）。",
    "- 只输出 markdown，不要任何额外解释。",
  ].join("\n");

  const result = await runner.run({ stage: "spec", system: "", input, tools: [] });
  return result.text;
}
