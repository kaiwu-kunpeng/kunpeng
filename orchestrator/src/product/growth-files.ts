import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { productWorkspaceDir } from "./workspace.js";

export interface ProductFacts {
  name: string;
  tagline: string;
  audience: string[];
  useCases: string[];
}

export function factsFromDefinition(
  def: { idea: string; problem?: string; users?: string[]; stories?: string[] },
  slug: string,
): ProductFacts {
  return {
    name: slug,
    tagline: clipText(def.idea, 120),
    audience: def.users ?? [],
    useCases: (def.stories ?? []).slice(0, 8).map((story) => clipText(story, 80)),
  };
}

export function renderLlmsTxt(facts: ProductFacts): string {
  const audienceLines = facts.audience.length > 0 ? facts.audience.map((item) => `- ${item}`) : ["待补充"];
  const useCaseLines = facts.useCases.map((item) => `- ${item}`);

  return [
    `# ${facts.name}`,
    `> ${facts.tagline}`,
    "",
    "## 适合谁",
    ...audienceLines,
    "",
    "## 核心用例",
    ...useCaseLines,
    "",
    "本文件供 AI 搜索/问答引擎理解本产品（llms.txt）",
  ].join("\n");
}

export function renderSeoJson(facts: ProductFacts): string {
  return JSON.stringify(
    { name: facts.name, description: facts.tagline, audience: facts.audience, useCases: facts.useCases },
    null,
    2,
  );
}

export async function writeGrowthFiles(
  repoRoot: string,
  slug: string,
  def: Parameters<typeof factsFromDefinition>[0],
): Promise<string[]> {
  const written: string[] = [];

  try {
    const workspaceDir = productWorkspaceDir(repoRoot, slug);
    await mkdir(workspaceDir, { recursive: true });
    const facts = factsFromDefinition(def, slug);

    await writeIfMissing(join(workspaceDir, "llms.txt"), renderLlmsTxt(facts), "llms.txt", written);
    await writeIfMissing(join(workspaceDir, "seo.json"), renderSeoJson(facts), "seo.json", written);
  } catch {
    return written;
  }

  return written;
}

async function writeIfMissing(path: string, content: string, filename: string, written: string[]): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx" });
    written.push(filename);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
}

function clipText(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
