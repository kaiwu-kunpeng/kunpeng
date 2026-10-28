import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DesignAdvice } from "./knowledge.js";

export interface DesignSystem {
  style?: string;
  palette?: { primary: string; secondary: string; cta: string };
  fonts?: { serif: string; sans: string };
  antiPatterns: string[];
  notes?: string;
}

export function seedFromAdvice(advice: DesignAdvice): DesignSystem {
  const p = advice.palettes[0];
  const f = advice.fonts[0];
  return {
    ...(advice.styles[0] && { style: advice.styles[0].name }),
    ...(p && { palette: { primary: p.primary, secondary: p.secondary, cta: p.cta } }),
    ...(f && { fonts: { serif: f.serif, sans: f.sans } }),
    antiPatterns: advice.antiPatterns.map((a) => a.rule),
  };
}

export function mergeOverride(master: DesignSystem, override: Partial<DesignSystem>): DesignSystem {
  return {
    style: override.style ?? master.style,
    palette: override.palette ?? master.palette,
    fonts: override.fonts ?? master.fonts,
    antiPatterns: [...new Set([...master.antiPatterns, ...(override.antiPatterns ?? [])])],
    ...(override.notes ?? master.notes ? { notes: override.notes ?? master.notes } : {}),
  };
}

export function renderMasterMd(ds: DesignSystem): string {
  const lines = ["# 设计系统 MASTER", ""];
  if (ds.style) lines.push(`**风格**: ${ds.style}`);
  if (ds.palette) lines.push(`**配色**: primary ${ds.palette.primary} · secondary ${ds.palette.secondary} · CTA ${ds.palette.cta}`);
  if (ds.fonts) lines.push(`**字体**: ${ds.fonts.serif} / ${ds.fonts.sans}`);
  if (ds.notes) lines.push(`**备注**: ${ds.notes}`);
  lines.push("", "## 反模式(必避)");
  for (const a of ds.antiPatterns) lines.push(`- ${a}`);
  return lines.join("\n") + "\n";
}

function masterDir(baseDir: string, slug: string): string {
  return join(baseDir, slug);
}

function masterJsonPath(baseDir: string, slug: string): string {
  return join(masterDir(baseDir, slug), "master.json");
}

function masterMdPath(baseDir: string, slug: string): string {
  return join(masterDir(baseDir, slug), "MASTER.md");
}

function pageOverridePath(baseDir: string, slug: string, page: string): string {
  return join(masterDir(baseDir, slug), "pages", `${page}.json`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeMaster(baseDir: string, slug: string, ds: DesignSystem): Promise<void> {
  const dir = masterDir(baseDir, slug);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(masterJsonPath(baseDir, slug), `${JSON.stringify(ds, null, 2)}\n`, "utf8"),
    writeFile(masterMdPath(baseDir, slug), renderMasterMd(ds), "utf8"),
  ]);
}

export async function readMaster(baseDir: string, slug: string): Promise<DesignSystem | null> {
  try {
    return JSON.parse(await readFile(masterJsonPath(baseDir, slug), "utf8")) as DesignSystem;
  } catch {
    return null;
  }
}

export async function writePageOverride(
  baseDir: string,
  slug: string,
  page: string,
  override: Partial<DesignSystem>,
): Promise<void> {
  await writeJson(pageOverridePath(baseDir, slug, page), override);
}

export async function resolveDesignSystem(baseDir: string, slug: string, page?: string): Promise<DesignSystem | null> {
  const master = await readMaster(baseDir, slug);
  if (!master || !page) return master;

  try {
    const override = JSON.parse(await readFile(pageOverridePath(baseDir, slug, page), "utf8")) as Partial<DesignSystem>;
    return mergeOverride(master, override);
  } catch {
    return master;
  }
}
