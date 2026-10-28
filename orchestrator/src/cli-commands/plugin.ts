import { isRecord } from "../util/is-record.js";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { checkMinVersion, isInsidePluginRoot, loadPluginDir } from "../plugin/manifest.js";
import { packPlugin, unpackKpkg } from "../plugin/pack.js";
import { cloneGitSource, gitCacheDir, gitHeadOf, isGitUrl } from "../plugin/git-source.js";
import { compareSemver } from "../runtime/update-channel.js";
import {
  diagnosePlugins, fileSha256, loadMarketplace, marketplacePath, renderDoctor, sourceLabel, type MarketplaceSource,
} from "../plugin/marketplace.js";
import { renderPluginValidation, validatePlugin } from "../plugin/validate.js";
import {
  listPlugins,
  pluginsRoot,
  removePlugin,
  setPluginEnabled,
  upsertPlugin,
  type PluginRecord,
} from "../plugin/store.js";
import {
  listMcpServers,
  mcpRoot,
  registerMcpServer,
  removeMcpServer,
  setMcpEnabled,
  type McpEntry,
} from "../mcp/registry.js";
import { listSkills, registerSkill, removeSkill, setSkillFields, skillsRoot, type SkillEntry } from "../skills/registry.js";
import { scanSkillSafety } from "../skills/skill-safety.js";
import { skillEntryFromDir } from "../skills/skill-md.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { errorMessage } from "../util/errors.js";

const USAGE = [
  "用法: kunpeng plugin <validate|add|pack|list|market|doctor|upgrade|rollback|enable|disable|remove> ...",
  "  kunpeng plugin validate <目录> [--strict]",
  "  kunpeng plugin add <本地目录|.kpkg|git url --commit <40位sha>> [--enable]",
  "  kunpeng plugin pack <目录> [--out <路径>]",
  "  kunpeng plugin list",
  "  kunpeng plugin market  列出 marketplace.json 市场清单",
  "  kunpeng plugin doctor  只读对账市场与已装插件（有错误时退出码 1）",
  "  kunpeng plugin upgrade <name> [<目录|.kpkg|git url> --commit <sha>]  不给来源则按 marketplace.json；只升不降",
  "  kunpeng plugin rollback <name>  换回上一版本（再 rollback 可换回来）",
  "  kunpeng plugin enable <name>",
  "  kunpeng plugin disable <name>",
  "  kunpeng plugin remove <name>",
].join("\n");

export async function addPluginFromDir(root: string, dir: string): Promise<PluginRecord> {
  const absoluteDir = resolve(dir);
  const { manifest } = await loadPluginDir(absoluteDir);
  const compatibility = checkMinVersion(manifest);
  if (!compatibility.ok) {
    throw new Error(compatibility.reason ?? `插件 ${manifest.name} 与当前鲲鹏版本不兼容`);
  }

  const record: PluginRecord = {
    name: manifest.name,
    version: manifest.version,
    dir: absoluteDir,
    enabled: false,
    addedAt: new Date().toISOString(),
  };
  await upsertPlugin(root, record);
  return record;
}

/** 插件要注册的 id 与既有注册表的冲突：MCP id 已被非插件来源占用、技能 id 已由插件目录之外的技能占用 → 一律拒绝。
 *  曾：插件 .mcp.json 的 key 若与用户已有 MCP（如 github）同名会静默覆盖；技能 id = 目录名，两插件同名目录互相覆盖。 */
export function findPluginRegistrationConflicts(input: {
  pluginDir: string;
  skillIds: string[];
  mcpIds: string[];
  existingSkills: Pick<SkillEntry, "id" | "dir">[];
  existingMcp: Pick<McpEntry, "id" | "origin">[];
}): string[] {
  const conflicts: string[] = [];
  const pluginRoot = resolve(input.pluginDir);
  for (const id of input.mcpIds) {
    const existing = input.existingMcp.find((entry) => entry.id === id);
    if (existing !== undefined && existing.origin !== "plugin") {
      conflicts.push(`MCP id 冲突：${id} 已被 ${existing.origin ?? "user"} 来源占用`);
    }
  }
  for (const id of input.skillIds) {
    const existing = input.existingSkills.find((entry) => entry.id === id);
    if (existing !== undefined && !isInsidePluginRoot(pluginRoot, existing.dir)) {
      conflicts.push(`技能 id 冲突：${id} 已由 ${existing.dir} 注册`);
    }
  }
  return conflicts;
}

export async function enablePlugin(root: string, name: string): Promise<PluginRecord> {
  const record = (await listPlugins(root)).find((plugin) => plugin.name === name);
  if (record === undefined) throw new Error(`未找到插件: ${name}`);

  const loaded = await loadPluginDir(record.dir);
  const skillDrafts = loaded.skillDirs.map((dir) => {
    const md = readFileSync(join(dir, "SKILL.md"), "utf8");
    return { dir, md, entry: skillEntryFromDir(dir, md, "vendored", basename(dir)) };
  });
  const mcpServers = loaded.mcpPath === undefined ? {} : readMcpServers(loaded.mcpPath);

  // 先查冲突再动注册表：任一冲突即整体拒绝，不留半启用状态。
  const conflicts = findPluginRegistrationConflicts({
    pluginDir: record.dir,
    skillIds: skillDrafts.map((draft) => draft.entry.id),
    mcpIds: Object.keys(mcpServers),
    existingSkills: listSkills(skillsRoot()),
    existingMcp: await listMcpServers(mcpRoot()),
  });
  if (conflicts.length > 0) {
    throw new Error(`插件 ${name} 启用被拒绝：\n- ${conflicts.join("\n- ")}`);
  }

  const registeredSkills: string[] = [];
  for (const { dir, md, entry } of skillDrafts) {
    // 第三方技能与自家蒸馏技能同一道安全扫描：硬拦项非空就不启用这个技能。
    const verdict = scanSkillSafety(md);
    if (verdict.block.length > 0) {
      console.warn(`[插件] 技能 ${basename(dir)} 安全扫描未通过（${verdict.block.join("、")}），拒绝启用`);
      continue;
    }
    if (verdict.warn.length > 0) console.warn(`[插件] 技能 ${basename(dir)} 安全扫描提示：${verdict.warn.join("、")}`);
    try {
      const registered = registerSkill(skillsRoot(), { ...entry, enabled: true });
      registeredSkills.push(registered.id);
    } catch (error: unknown) {
      console.warn(`[插件] 技能 ${basename(dir)} 注册失败，已跳过：${errorMessage(error)}`);
    }
  }

  const registeredMcpIds: string[] = [];
  for (const [id, config] of Object.entries(mcpServers)) {
    await registerMcpServer(mcpRoot(), mcpEntry(id, config));
    registeredMcpIds.push(id);
  }

  return setPluginEnabled(root, name, true, {
    skills: registeredSkills,
    mcpIds: registeredMcpIds,
  });
}

async function disablePlugin(root: string, name: string): Promise<PluginRecord> {
  const record = (await listPlugins(root)).find((plugin) => plugin.name === name);
  if (record === undefined) throw new Error(`未找到插件: ${name}`);

  for (const id of record.skills ?? []) setSkillFields(skillsRoot(), id, { enabled: false });
  for (const id of record.mcpIds ?? []) await setMcpEnabled(mcpRoot(), id, false);
  return setPluginEnabled(root, name, false);
}

function readMcpServers(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    throw new Error(`MCP config at ${path} must contain an mcpServers object`);
  }
  return parsed.mcpServers;
}

function mcpEntry(id: string, value: unknown): McpEntry {
  if (!isRecord(value)) throw new Error(`MCP server 配置必须是对象: ${id}`);
  const url = optionalString(value, "url", id);
  const common = { id, enabled: true, origin: "plugin" as const };
  if (url !== undefined) {
    return {
      ...common,
      transport: "http",
      url,
      ...optionalStringRecordField(value, "headers", id),
    };
  }
  return {
    ...common,
    transport: "stdio",
    ...optionalStringField(value, "command", id),
    ...optionalStringArrayField(value, "args", id),
    ...optionalStringRecordField(value, "env", id),
  };
}

function optionalString(value: Record<string, unknown>, field: string, id: string): string | undefined {
  const candidate = value[field];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string") throw new Error(`MCP server ${id} 的 ${field} 必须是字符串`);
  return candidate;
}

function optionalStringField(
  value: Record<string, unknown>, field: string, id: string,
): Record<string, string> {
  const candidate = optionalString(value, field, id);
  return candidate === undefined ? {} : { [field]: candidate };
}

function optionalStringArrayField(
  value: Record<string, unknown>, field: string, id: string,
): { args?: string[] } {
  const candidate = value[field];
  if (candidate === undefined) return {};
  if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === "string")) {
    throw new Error(`MCP server ${id} 的 ${field} 必须是字符串数组`);
  }
  return { args: candidate };
}

function optionalStringRecordField(
  value: Record<string, unknown>, field: "env" | "headers", id: string,
): { env?: Record<string, string>; headers?: Record<string, string> } {
  const candidate = value[field];
  if (candidate === undefined) return {};
  if (!isRecord(candidate) || !Object.values(candidate).every((item) => typeof item === "string")) {
    throw new Error(`MCP server ${id} 的 ${field} 必须是字符串映射`);
  }
  return field === "env"
    ? { env: candidate as Record<string, string> }
    : { headers: candidate as Record<string, string> };
}

/** 把命令行来源物化成插件目录：git url（须 --commit）→ clone 到 cache/；.kpkg → 解包到 cache/；其余视为本地目录。 */
async function materializeSource(root: string, source: MarketplaceSource): Promise<string> {
  if (source.kind === "git") return cloneGitSource({ url: source.url, commit: source.commit, destDir: gitCacheDir(root, source.url, source.commit) });
  if (source.kind === "kpkg") return unpackKpkg(source.path, join(root, "cache"));
  return source.path;
}

function sourceFromArgs(argument: string, rest: string[]): MarketplaceSource {
  if (isGitUrl(argument)) {
    const commit = rest[rest.indexOf("--commit") + 1];
    if (!rest.includes("--commit") || commit === undefined || commit.startsWith("--")) throw new Error("git 来源须带 --commit <40 位 sha> 钉版");
    return { kind: "git", url: argument, commit };
  }
  if (/^(?:https?:\/\/|git@)/.test(argument)) throw new Error("暂不支持该 git 地址形态，请用 https:// 或 git@ 开头并带 --commit");
  return argument.endsWith(".kpkg") ? { kind: "kpkg", path: argument, sha256: "" } : { kind: "local", path: argument };
}

/** 换版（upgrade / rollback 共用）：先停旧版并注销它登记的技能/MCP（否则新版同名技能会被判冲突），
 *  再登记新版并把旧版记成 previous，原来启用则重新启用新版（重新登记新版目录下的技能/MCP）。 */
async function replacePluginVersion(root: string, current: PluginRecord, next: { version: string; dir: string }): Promise<PluginRecord> {
  if (current.enabled) await disablePlugin(root, current.name);
  for (const id of current.skills ?? []) removeSkill(skillsRoot(), id);
  const registeredMcp = new Set((await listMcpServers(mcpRoot())).map((entry) => entry.id));
  for (const id of current.mcpIds ?? []) if (registeredMcp.has(id)) await removeMcpServer(mcpRoot(), id);
  const now = new Date().toISOString();
  await upsertPlugin(root, {
    name: current.name, version: next.version, dir: next.dir, enabled: false, addedAt: now,
    previous: { version: current.version, dir: current.dir, replacedAt: now, ...(current.skills ? { skills: current.skills } : {}), ...(current.mcpIds ? { mcpIds: current.mcpIds } : {}) },
  });
  if (!current.enabled) return (await listPlugins(root)).find((plugin) => plugin.name === current.name)!;
  return enablePlugin(root, current.name);
}

export async function upgradePlugin(root: string, name: string, source?: MarketplaceSource): Promise<{ from: string; to: string }> {
  const current = (await listPlugins(root)).find((plugin) => plugin.name === name);
  if (current === undefined) throw new Error(`未找到插件: ${name}`);
  const chosen = source ?? loadMarketplace(root).entries.find((entry) => entry.name === name)?.source;
  if (chosen === undefined) throw new Error(`升级 ${name} 需要来源：命令行给 <目录|.kpkg|git url --commit <sha>>，或在 marketplace.json 登记该插件`);
  const dir = resolve(await materializeSource(root, chosen));
  const { manifest } = await loadPluginDir(dir);
  if (manifest.name !== name) throw new Error(`来源插件名「${manifest.name}」与 ${name} 不符，拒绝升级`);
  if (compareSemver(manifest.version, current.version) <= 0) throw new Error(`已装 ${current.version}，候选 ${manifest.version} 不是更新版本，拒绝升级（要换回旧版用 kunpeng plugin rollback）`);
  const compatibility = checkMinVersion(manifest);
  if (!compatibility.ok) throw new Error(compatibility.reason ?? `插件 ${name} 与当前鲲鹏版本不兼容`);
  await replacePluginVersion(root, current, { version: manifest.version, dir });
  return { from: current.version, to: manifest.version };
}

export async function rollbackPlugin(root: string, name: string): Promise<{ from: string; to: string }> {
  const current = (await listPlugins(root)).find((plugin) => plugin.name === name);
  if (current === undefined) throw new Error(`未找到插件: ${name}`);
  if (current.previous === undefined) throw new Error(`${name} 没有可回退的上一版本`);
  if (!existsSync(join(current.previous.dir, "kunpeng-plugin.json"))) throw new Error(`上一版本目录不在：${current.previous.dir}`);
  await replacePluginVersion(root, current, { version: current.previous.version, dir: current.previous.dir });
  return { from: current.version, to: current.previous.version };
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function printPlugins(records: PluginRecord[]): void {
  if (records.length === 0) {
    console.log("(无插件) 用 kunpeng plugin add <本地目录> 添加");
    return;
  }
  console.table(records.map((plugin) => ({
    名称: plugin.name,
    版本: plugin.version,
    启用: plugin.enabled,
    目录: plugin.dir,
    技能: plugin.skills?.length ?? 0,
    MCP: plugin.mcpIds?.length ?? 0,
  })));
}

async function run(context: CliContext): Promise<void> {
  const subcommand = context.rest[0];
  const argument = context.rest[1];
  if (!subcommand || !["validate", "add", "pack", "list", "market", "doctor", "upgrade", "rollback", "enable", "disable", "remove"].includes(subcommand)) {
    fail(USAGE);
    return;
  }

  const root = pluginsRoot();
  try {
    if (subcommand === "validate") {
      if (!argument || argument.startsWith("--")) throw new Error(USAGE);
      const report = await validatePlugin(argument, {
        strict: context.rest.includes("--strict") || context.argv.includes("--strict"),
      });
      console.log(renderPluginValidation(report));
      if (!report.ok) process.exitCode = 1;
    } else if (subcommand === "list") {
      printPlugins(await listPlugins(root));
    } else if (subcommand === "market") {
      const marketplace = loadMarketplace(root);
      if (marketplace.entries.length === 0) {
        console.log(`市场为空：${marketplacePath(root)} 不存在或无条目`);
        return;
      }
      console.table(marketplace.entries.map((entry) => ({
        name: entry.name,
        distribution: entry.distribution,
        source: sourceLabel(entry.source),
        pin: entry.pin ?? "",
        说明: entry.description ?? "",
      })));
    } else if (subcommand === "doctor") {
      const marketplace = loadMarketplace(root);
      const installed = await listPlugins(root);
      const findings = diagnosePlugins({ marketplace, installed, dirExists: existsSync, kpkgSha256: fileSha256, gitHead: gitHeadOf });
      console.log(renderDoctor(findings, marketplace.entries.length, installed.length));
      if (findings.some((finding) => finding.severity === "error")) process.exitCode = 1;
    } else if (subcommand === "pack") {
      if (!argument) throw new Error(USAGE);
      const packed = await packPlugin(argument, context.outArg);
      console.log(`[插件] 已打包 ${packed.path}`);
      console.log(`sha256 ${packed.sha256}`);
    } else if (subcommand === "add") {
      if (!argument) throw new Error(USAGE);
      const added = await addPluginFromDir(root, await materializeSource(root, sourceFromArgs(argument, context.rest)));
      if (context.rest.includes("--enable") || context.argv.includes("--enable")) {
        await enablePlugin(root, added.name);
        console.log(`[插件] 已添加并启用 ${added.name}；运行 kunpeng mcp sync 让 MCP 生效`);
      } else {
        console.log(`[插件] 已登记 ${added.name}（尚未启用）`);
      }
    } else if (subcommand === "upgrade") {
      if (!argument) throw new Error(USAGE);
      const given = context.rest[2];
      const result = await upgradePlugin(root, argument, given === undefined || given.startsWith("--") ? undefined : sourceFromArgs(given, context.rest));
      console.log(`[插件] 已升级 ${argument} ${result.from} → ${result.to}（换回：kunpeng plugin rollback ${argument}；MCP 变了就跑 kunpeng mcp sync）`);
    } else if (subcommand === "rollback") {
      if (!argument) throw new Error(USAGE);
      const result = await rollbackPlugin(root, argument);
      console.log(`[插件] 已回退 ${argument} ${result.from} → ${result.to}`);
    } else {
      if (!argument) throw new Error(USAGE);
      if (subcommand === "enable") {
        await enablePlugin(root, argument);
        console.log(`[插件] 已启用 ${argument}；运行 kunpeng mcp sync 让 MCP 生效`);
      } else if (subcommand === "disable") {
        await disablePlugin(root, argument);
        console.log(`[插件] 已停用 ${argument}`);
      } else {
        await disablePlugin(root, argument);
        await removePlugin(root, argument);
        console.log(`[插件] 已移除登记 ${argument}（磁盘目录保留）`);
      }
    }
  } catch (error: unknown) {
    fail(errorMessage(error));
  }
}

registerCliCommand({ name: "plugin", run });
