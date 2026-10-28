// 项目设计配置读写 —— 把 ProjectDesignConfig 落到 `.kunpeng/project.json` 的 `design` 字段。
// 读永不抛（缺文件/缺字段/解析失败一律 undefined）；写合并保留其他字段（如 id/name）。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProjectDesignConfig } from "../design/contract.js";

function projectJsonPath(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "project.json");
}

/** 读取项目设计配置；缺文件 / 缺 design 字段 / 解析失败一律返回 undefined，永不抛。 */
export async function readDesignConfig(repoRoot: string): Promise<ProjectDesignConfig | undefined> {
  try {
    const data = JSON.parse(await readFile(projectJsonPath(repoRoot), "utf8"));
    return (data?.design as ProjectDesignConfig | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 把 design 合并进既有 project.json（保留 id/name 等其他字段），mkdir -p，2 空格缩进。 */
export async function writeDesignConfig(repoRoot: string, design: ProjectDesignConfig): Promise<void> {
  const path = projectJsonPath(repoRoot);
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object") existing = parsed as Record<string, unknown>;
  } catch {
    // 无既有文件或内容损坏：从空对象起，不阻断写入。
  }
  const merged = { ...existing, design };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
}
