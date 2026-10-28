export interface AiRepoKitInput {
  projectName: string;
  northStar?: string;
  domains?: string[];
}

export interface AiRepoFile {
  path: string;
  content: string;
}

function buildAgentsContent(input: AiRepoKitInput): string {
  const lines = [`# ${input.projectName} · AGENTS`, ""];

  if (input.northStar !== undefined) {
    lines.push(`> 北极星：${input.northStar}`, "");
  }

  lines.push(
    "## 工作纪律",
    "",
    "- 不准乱删非范围文件；所有改动必须限定在当前任务声明的范围内。",
    "- 不确定是否属于范围时，先停下补充说明再继续。",
  );

  return lines.join("\n");
}

function buildDomainKnowledgeContent(domains: string[] | undefined): string {
  const lines = ["# 领域知识", ""];

  if (domains === undefined || domains.length === 0) {
    lines.push("(待补充)");
    return lines.join("\n");
  }

  for (const domain of domains) {
    lines.push(`## ${domain}`, "", "(待补充)", "");
  }

  return lines.join("\n").trimEnd();
}

export function buildAiRepoKit(input: AiRepoKitInput): AiRepoFile[] {
  return [
    {
      path: "AGENTS.md",
      content: buildAgentsContent(input),
    },
    {
      path: "docs/domain-knowledge.md",
      content: buildDomainKnowledgeContent(input.domains),
    },
    {
      path: "docs/specs/README.md",
      content: ["# Specs 索引", "", "Specs 放置约定：每个需求或变更使用独立 Markdown 文件记录目标、范围与验收标准。"].join(
        "\n",
      ),
    },
    {
      path: "skills/README.md",
      content: ["# Skills 索引", "", "Skills 放置约定：每个可复用能力使用独立目录维护说明、脚本与必要素材。"].join("\n"),
    },
  ];
}
