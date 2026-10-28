import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProductDefinition, ProductDiscovery, ShapedPitch } from "./contract.js";

/** 产品名转目录 slug:小写 kebab,中文保留,截断 40。 */
export function productSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "product";
}

const list = (items: string[]): string => (items.length ? items.map((x) => `- ${x}`).join("\n") : "_(无)_");

/** DEFINE → PR-FAQ 风格 markdown(从客户问题+成功标准开篇)。各块用空行(join \n\n)分隔,勿用 filter 删空行。 */
export function renderDefineMd(def: ProductDefinition): string {
  const blocks: string[] = [
    `# PR-FAQ / 产品定义`,
    `**想法**：${def.idea}`,
    `**要解决的问题**：${def.problem}`,
  ];
  if (def.jobStatement) blocks.push(`**Job Statement（JTBD）**：${def.jobStatement}`);
  blocks.push(
    `## 目标用户\n\n${list(def.users)}`,
    `## 核心场景 / 用户故事\n\n${list(def.stories)}`,
    `## 成功标准（验收）\n\n${list(def.acceptance)}`,
    `## 非目标\n\n${list(def.nonGoals ?? [])}`,
  );
  return blocks.join("\n\n") + "\n";
}

/** DISCOVER → OST(机会-解法树)快照 markdown。各块用空行分隔。 */
export function renderDiscoverMd(d: ProductDiscovery): string {
  const opps = d.opportunities.length
    ? [
        "| 机会(outcome) | 重要性 | 满意度 | 机会分 |",
        "|---|---|---|---|",
        ...d.opportunities.map((o) => `| ${o.outcome} | ${o.importance} | ${o.satisfaction} | ${o.opportunityScore} |`),
      ].join("\n")
    : "_(无机会)_";
  const blocks: string[] = [`# DISCOVER · 机会发现（OST）`];
  if (d.syntheticEvidence) blocks.push("> ⚠️ 含合成证据（syntheticEvidence），需真实信号验证。");
  blocks.push(
    `**Job Statement**：${d.jobStatement}`,
    `## 目标用户\n\n${list(d.targetUsers)}`,
    `## 现有替代方案\n\n${list(d.alternatives)}`,
    `## 机会（按机会分排序）\n\n${opps}`,
  );
  return blocks.join("\n\n") + "\n";
}

/** SHAPE → Shape Up pitch 五要素 markdown。 */
export function renderPitchMd(p: ShapedPitch): string {
  return [
    `# SHAPE · Pitch：${p.title}`,
    "",
    `**Appetite（时间预算）**：${p.appetite}`,
    "",
    "## Problem",
    "",
    p.problem,
    "",
    "## Solution",
    "",
    p.solution,
    "",
    "## Build Scope",
    "",
    list(p.buildScope),
    "",
    "## Rabbit Holes（要避开的坑）",
    "",
    list(p.rabbitHoles),
    "",
    "## No-Gos（明确不做）",
    "",
    list(p.noGos),
    "",
    "## 成功指标",
    "",
    list(p.successMetrics),
    "",
  ].join("\n") + "\n";
}

/** 薄写盘:把内容写到 docs/product/<slug>/<filename>,自动建目录。 */
export async function writeProductDoc(repoRoot: string, slug: string, filename: string, content: string): Promise<string> {
  const path = join(repoRoot, "docs", "product", slug, filename);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}
