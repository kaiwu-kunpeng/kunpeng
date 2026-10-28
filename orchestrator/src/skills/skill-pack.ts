/** 技能包构建（升级调研 U13）：把仓库 skills/ 下各技能按 Agent Skills 标准（agentskills.io/specification）
 *  打成带版本号的目录包，只构建不发布（对外发布属宪法 C5#3 人工门）。
 *  每包：<out>/<name>-<version>/<name>/（技能原样拷贝，目录名 = name）+ manifest.json（名称、版本、描述、来源 commit、
 *  文件 sha256、安全扫描结果）；SKILL.md 里用 ../ 引用的同级文件（如 LICENSE）一并放到包根，保持相对链接可用。
 *  标准校验不过、或 scanSkillSafety 有硬拦项的技能拒绝打包。 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { scanSkillSafety } from "./skill-safety.js";
import { parseSkillFrontmatter } from "./skill-md.js";

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  sourceCommit: string;
  files: Array<{ path: string; sha256: string }>;
  extraFiles: string[];
  safety: { block: string[]; warn: string[] };
}

export interface PackResult {
  packed: Array<{ name: string; version: string; dir: string; warn: string[] }>;
  rejected: Array<{ dir: string; reasons: string[] }>;
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Agent Skills 标准的 name / description 约束。 */
export function agentSkillsErrors(name: unknown, description: unknown, dirName: string): string[] {
  const errors: string[] = [];
  if (typeof name !== "string" || name.length < 1 || name.length > 64 || !NAME_RE.test(name)) {
    errors.push("name 须为 1-64 位小写字母、数字与单个连字符，且不以连字符开头或结尾");
  } else if (name !== dirName) {
    errors.push(`name「${name}」须与目录名「${dirName}」一致`);
  }
  if (typeof description !== "string" || description.trim().length < 1 || description.length > 1024) {
    errors.push("description 须为 1-1024 字符");
  }
  return errors;
}

/** metadata.version（标准推荐写法）；缺省 0.0.0。 */
export function skillVersion(md: string): string {
  const block = /^metadata:[ \t]*\n((?:[ \t]+.*\n?)*)/m.exec(md)?.[1] ?? "";
  const version = /^[ \t]+version:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m.exec(block)?.[1];
  return version && /^[0-9A-Za-z.+-]+$/.test(version) ? version : "0.0.0";
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

export function packSkills(opts: { skillsRoot: string; outDir: string; commit: string }): PackResult {
  const result: PackResult = { packed: [], rejected: [] };
  const dirs = readdirSync(opts.skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(opts.skillsRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  for (const dirName of dirs) {
    const skillDir = join(opts.skillsRoot, dirName);
    const md = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const fm = parseSkillFrontmatter(md) as Record<string, unknown> | null;
    const errors = agentSkillsErrors(fm?.name, fm?.description, dirName);
    if (errors.length > 0) { result.rejected.push({ dir: dirName, reasons: errors }); continue; }
    const files = listFiles(skillDir);
    const block = new Set<string>();
    const warn = new Set<string>();
    for (const file of files.filter((f) => /\.(?:md|txt|sh|py|js|ts)$/i.test(f))) {
      const verdict = scanSkillSafety(readFileSync(file, "utf8"));
      verdict.block.forEach((r) => block.add(r));
      verdict.warn.forEach((r) => warn.add(r));
    }
    if (block.size > 0) {
      result.rejected.push({ dir: dirName, reasons: [`技能安全扫描未通过：${[...block].join("、")}`] });
      continue;
    }
    const name = fm!.name as string;
    const version = skillVersion(md);
    const pkgDir = join(opts.outDir, `${name}-${version}`);
    rmSync(pkgDir, { recursive: true, force: true });
    const manifestFiles: SkillManifest["files"] = [];
    for (const file of files) {
      const rel = relative(skillDir, file);
      const target = join(pkgDir, name, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      copyFileSync(file, target);
      manifestFiles.push({ path: `${name}/${rel}`, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") });
    }
    const extraFiles: string[] = [];
    for (const match of md.matchAll(/\.\.\/([A-Za-z0-9._-]+)/g)) {
      const sibling = join(opts.skillsRoot, match[1]!);
      if (existsSync(sibling) && statSync(sibling).isFile() && !extraFiles.includes(match[1]!)) {
        copyFileSync(sibling, join(pkgDir, match[1]!));
        extraFiles.push(match[1]!);
      }
    }
    const manifest: SkillManifest = {
      name,
      version,
      description: fm!.description as string,
      sourceCommit: opts.commit,
      files: manifestFiles,
      extraFiles,
      safety: { block: [], warn: [...warn] },
    };
    writeFileSync(join(pkgDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    result.packed.push({ name, version, dir: pkgDir, warn: [...warn] });
  }
  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(join(opts.outDir, "index.json"), `${JSON.stringify({ sourceCommit: opts.commit, ...result }, null, 2)}\n`);
  return result;
}
