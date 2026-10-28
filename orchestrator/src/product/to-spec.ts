import { PRODUCT_DEFINE_FAQ_ANCHORS, type ProductDefinition } from "./contract.js";
import { assessConcreteness } from "./concreteness.js";
import { liftAcceptance, renderGherkin } from "./gherkin.js";
import { critiqueDefinition } from "./pm-critic.js";

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function anchorLabel(anchor: string): string {
  const item = PRODUCT_DEFINE_FAQ_ANCHORS.find((candidate) => candidate.anchor === anchor);
  return item === undefined ? anchor : `[${item.anchor}] ${item.label}`;
}

export function definitionToSpec(def: ProductDefinition): string {
  const title = def.idea === "" ? "（未命名需求）" : def.idea;
  const acceptanceScenarios = liftAcceptance(def.acceptance);
  const acceptanceBlock = acceptanceScenarios.length > 0 ? renderGherkin(acceptanceScenarios) : "- （未明确）";
  const concreteness = assessConcreteness(def);
  const critique = critiqueDefinition(def);

  const body = [
    `# 段一：${title}`,
    "",
    "> 产品轨 DEFINE 访谈生成的 PR FAQ 需求草稿。实现前请补充技术细节与可执行 accept 命令。",
    "",
    "**Press Release**：",
    def.problem,
    "",
    `**用户的 Job（JTBD）**：${def.jobStatement ?? "（未明确）"}`,
    "",
    "**FAQ**：",
    "",
    `**${anchorLabel("prfaq-problem")}**：${def.problem}`,
    "",
    `**${anchorLabel("prfaq-users")}**：`,
    list(def.users),
    "",
    `**${anchorLabel("prfaq-scenarios")}**：`,
    list(def.stories),
    "",
    `**${anchorLabel("prfaq-success")}**：`,
    acceptanceBlock,
    "",
    `**${anchorLabel("prfaq-non-goals")}**：`,
    def.nonGoals?.length ? list(def.nonGoals) : "- （未明确）",
    "",
    "```accept",
    'echo "# 验收契约：上方每个 Gherkin 场景 = 1 个任务 = 1 个测试（每场景独立可测），实现时按场景拆分并逐一断言 Given/When/Then"',
    "```",
  ].join("\n");

  const preface: string[] = [];

  if (!concreteness.pass) {
    preface.push(
      "> 🚫 **具体性门未通过（需人工补全后方可进入开发）**",
      ...concreteness.issues.map((issue) => `> - [${issue.field}] ${issue.problem}`),
      "",
    );
  }

  if (critique.verdict !== "pass") {
    preface.push(
      `> 🔴 **PM 红队评审：${critique.verdict}**（建议人工复核）`,
      ...critique.findings.map(
        (finding) => `> - [${finding.severity}/${finding.category}] ${finding.issue} → ${finding.suggestion}`,
      ),
      "",
    );
  }

  if (preface.length === 0) {
    return body;
  }

  return [...preface, body].join("\n");
}
