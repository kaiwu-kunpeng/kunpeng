import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareSemver } from "../runtime/update-channel.js";
import { hasErrnoCode } from "../util/errors.js";
import { isRecord } from "../util/is-record.js";
import { GIT_COMMIT_PATTERN, GIT_URL_PATTERN } from "./git-source.js";
import type { PluginRecord } from "./store.js";

export const PLUGIN_DISTRIBUTIONS = ["off", "on", "required"] as const;
export type PluginDistribution = typeof PLUGIN_DISTRIBUTIONS[number];

export type MarketplaceSource =
  | { kind: "local"; path: string }
  | { kind: "kpkg"; path: string; sha256: string }
  /** git 来源：url + 钉死的 40 位 commit（P1-7c）；装/升级时 clone 到插件根 cache/ 下并 checkout 到该 commit。 */
  | { kind: "git"; url: string; commit: string };

export interface MarketplaceEntry {
  name: string;
  source: MarketplaceSource;
  distribution: PluginDistribution;
  pin?: string;
  description?: string;
}

export interface Marketplace {
  entries: MarketplaceEntry[];
}

export const MARKETPLACE_FILE = "marketplace.json";
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function marketplacePath(pluginsRoot: string): string {
  return join(pluginsRoot, MARKETPLACE_FILE);
}

export function parseMarketplace(raw: string): Marketplace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${MARKETPLACE_FILE} 须为包含 entries 数组的 JSON 对象`, { cause: error });
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error(`${MARKETPLACE_FILE} 须为包含 entries 数组的对象`);
  }

  const names = new Set<string>();
  const entries = parsed.entries.map((entry: unknown, index): MarketplaceEntry => {
    const label = `${MARKETPLACE_FILE} entries[${index}]`;
    if (!isRecord(entry)) throw new Error(`${label} 须为对象`);
    if (typeof entry.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name) || entry.name.trim() !== entry.name) {
      throw new Error(`${label} name 须为小写字母、数字或连字符，且以字母或数字开头`);
    }
    if (names.has(entry.name)) throw new Error(`${label} name 重复「${entry.name}」`);
    names.add(entry.name);

    if (!isRecord(entry.source)) throw new Error(`${label} source 须为带 kind 的对象`);
    const { kind, path, sha256, url, commit } = entry.source;
    if (kind !== "local" && kind !== "kpkg" && kind !== "git") throw new Error(`${label} source.kind 须为 local/kpkg/git`);
    let source: MarketplaceSource;
    if (kind === "git") {
      if (typeof url !== "string" || !GIT_URL_PATTERN.test(url)) {
        throw new Error(`${label} git 来源 url 须为 https/ssh/git@/file 地址`);
      }
      if (typeof commit !== "string" || !GIT_COMMIT_PATTERN.test(commit)) {
        throw new Error(`${label} git 来源必须钉 commit（40 位十六进制）`);
      }
      source = { kind, url, commit: commit.toLowerCase() };
    } else if (typeof path !== "string" || path.trim().length === 0) {
      throw new Error(`${label} source.path 须为非空字符串`);
    } else if (kind === "kpkg") {
      if (typeof sha256 !== "string" || sha256.length !== 64 || !/^[0-9a-f]{64}$/i.test(sha256)) {
        throw new Error(`${label} kpkg 来源必须钉 sha256（64 位十六进制）`);
      }
      source = { kind, path, sha256: sha256.toLowerCase() };
    } else {
      source = { kind, path };
    }

    const distribution = entry.distribution === undefined ? "on" : entry.distribution;
    if (distribution !== "off" && distribution !== "on" && distribution !== "required") {
      throw new Error(`${label} distribution 须为 off/on/required`);
    }
    if (entry.pin !== undefined && (typeof entry.pin !== "string" || entry.pin.trim() !== entry.pin || !SEMVER_PATTERN.test(entry.pin))) {
      throw new Error(`${label} pin 须为 semver`);
    }
    if (entry.description !== undefined && typeof entry.description !== "string") {
      throw new Error(`${label} description 须为字符串`);
    }

    return {
      name: entry.name,
      source,
      distribution,
      ...(entry.pin === undefined ? {} : { pin: entry.pin }),
      ...(entry.description === undefined ? {} : { description: entry.description }),
    };
  });
  return { entries };
}

/** 来源的一行展示：local:/p、kpkg:/p.kpkg、git:<url>@<commit12>。 */
export function sourceLabel(source: MarketplaceSource): string {
  return source.kind === "git" ? `git:${source.url}@${source.commit.slice(0, 12)}` : `${source.kind}:${source.path}`;
}

/** 按来源给出安装命令（doctor 的 fix 与 upgrade 提示共用）。 */
export function installCommand(entry: MarketplaceEntry): string {
  const target = entry.source.kind === "git" ? `${entry.source.url} --commit ${entry.source.commit}` : entry.source.path;
  return `kunpeng plugin add ${target} --enable`;
}

export function loadMarketplace(pluginsRoot: string): Marketplace {
  let raw: string;
  try {
    raw = readFileSync(marketplacePath(pluginsRoot), "utf8");
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) return { entries: [] };
    throw error;
  }
  return parseMarketplace(raw);
}

export interface DoctorFinding {
  severity: "error" | "warn";
  plugin: string;
  issue: string;
  fix: string;
}

export function diagnosePlugins(input: {
  marketplace: Marketplace;
  installed: PluginRecord[];
  dirExists: (path: string) => boolean;
  kpkgSha256?: (path: string) => string | undefined;
  /** 读已装目录的 git HEAD（40 位小写）；不可读返回 undefined。缺省不查 git 来源。 */
  gitHead?: (dir: string) => string | undefined;
}): DoctorFinding[] {
  const { marketplace, installed, dirExists, kpkgSha256, gitHead } = input;
  const findings: DoctorFinding[] = [];
  const installedByName = new Map(installed.map((plugin) => [plugin.name, plugin]));
  const marketNames = new Set(marketplace.entries.map((entry) => entry.name));

  for (const entry of marketplace.entries) {
    const plugin = installedByName.get(entry.name);
    if (entry.distribution === "required") {
      if (plugin === undefined) {
        findings.push({ severity: "error", plugin: entry.name, issue: "required 但未安装", fix: installCommand(entry) });
      } else if (!plugin.enabled) {
        findings.push({ severity: "error", plugin: entry.name, issue: "required 但未启用", fix: `kunpeng plugin enable ${entry.name}` });
      }
    } else if (entry.distribution === "off" && plugin !== undefined) {
      findings.push({ severity: "warn", plugin: entry.name, issue: "市场已下架（off）但本机仍装着", fix: `kunpeng plugin remove ${entry.name}` });
    }
    if (plugin !== undefined && entry.pin !== undefined && compareSemver(plugin.version, entry.pin) !== 0) {
      findings.push({
        severity: "warn", plugin: entry.name,
        issue: `版本漂移：已装 ${plugin.version}，市场 pin ${entry.pin}`,
        fix: `核对 ${MARKETPLACE_FILE} 的 pin 与来源版本后重新安装`,
      });
    }
    if (entry.source.kind === "kpkg") {
      const actual = kpkgSha256?.(entry.source.path);
      if (actual === undefined) {
        findings.push({ severity: "warn", plugin: entry.name, issue: `kpkg 不可读：${entry.source.path}`, fix: "检查包路径及读取权限后重新运行 kunpeng plugin doctor" });
      } else if (actual !== entry.source.sha256) {
        findings.push({
          severity: "error", plugin: entry.name,
          issue: "kpkg sha256 与市场钉的不符（包被改过或清单过期）",
          fix: `核对包来源与 ${MARKETPLACE_FILE} 的 sha256`,
        });
      }
    } else if (entry.source.kind === "git" && plugin !== undefined && gitHead !== undefined) {
      const head = gitHead(plugin.dir);
      if (head === undefined) {
        findings.push({ severity: "warn", plugin: entry.name, issue: `git 目录 HEAD 不可读：${plugin.dir}`, fix: `kunpeng plugin upgrade ${entry.name} 重新从市场来源拉取` });
      } else if (head !== entry.source.commit) {
        findings.push({
          severity: "error", plugin: entry.name,
          issue: `git commit 与市场钉的不符（已装 ${head.slice(0, 12)}，市场钉 ${entry.source.commit.slice(0, 12)}）`,
          fix: `kunpeng plugin upgrade ${entry.name} 换到市场钉的 commit，或核对 ${MARKETPLACE_FILE}`,
        });
      }
    }
  }

  for (const plugin of installed) {
    if (!dirExists(plugin.dir)) {
      findings.push({ severity: "error", plugin: plugin.name, issue: `已登记但目录不在：${plugin.dir}`, fix: "恢复插件目录或用 kunpeng plugin add <本地目录> 重新登记" });
    }
    if (marketNames.size > 0 && !marketNames.has(plugin.name)) {
      findings.push({ severity: "warn", plugin: plugin.name, issue: "不在市场清单里（野装）", fix: `核对来源后补入 ${MARKETPLACE_FILE}，或用 kunpeng plugin remove ${plugin.name} 移除登记` });
    }
  }
  return findings;
}

export function fileSha256(path: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

export function renderDoctor(findings: DoctorFinding[], marketplaceCount: number, installedCount: number): string {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.length - errors;
  const summary = findings.length === 0 ? "✓ 无问题" : `✗ ${errors} 错 / ${warnings} 警`;
  return [
    `市场 ${marketplaceCount} 条 · 已装 ${installedCount} 个 · ${summary}`,
    ...findings.map((finding) => `  ${finding.severity === "error" ? "错误" : "警告"} ${finding.plugin}: ${finding.issue} → ${finding.fix}`),
  ].join("\n");
}
