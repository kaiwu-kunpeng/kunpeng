import { isRecord } from "../util/is-record.js";
import { readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, isAbsolute } from "node:path";

import { compareSemver } from "../runtime/update-channel.js";

/** 五类贡献的合并语义：skills → 技能注册表，撞名即拒（P0-3）；
 * mcp → MCP 注册表，宿主凭据 env 剥离（P0-2）；
 * agents / workflows 只发现只读，采用须分别走人工门 #2 / 派流；
 * hooks 只校验形状，启用须人工逐条审阅（会跑 shell）。 */
export const PLUGIN_CONTRIBUTION_KINDS = ["skills", "agents", "hooks", "mcp", "workflows"] as const;
export type PluginContributionKind = typeof PLUGIN_CONTRIBUTION_KINDS[number];

export const PLUGIN_HOOK_EVENTS = ["preMerge", "sessionStart"] as const;
export type PluginHooks = Partial<Record<typeof PLUGIN_HOOK_EVENTS[number], string[]>>;

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  minKunpengVersion?: string;
  skillsDir?: string;
  mcpConfig?: string;
  /** 缺省为 agents/。 */
  agentsDir?: string;
  /** 缺省为 hooks.json。 */
  hooksConfig?: string;
  /** 缺省为 workflows/。 */
  workflowsDir?: string;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  skillDirs: string[];
  mcpPath?: string;
  agentFiles: string[];
  workflowFiles: string[];
  hooksPath?: string;
  hooks?: PluginHooks;
}

function optionalString(
  value: Record<string, unknown>,
  field: keyof PluginManifest,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, field)) return undefined;

  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    throw new Error(`plugin manifest field "${field}" must be a string`);
  }
  return fieldValue;
}

/** 完整 semver：主.次.补丁，可带预发布 / 构建元数据；"1.0"、"1.0.0.0"、"1.0.0 beta" 一律拒绝。 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** manifest 里的相对路径解析后必须仍在插件目录之内（曾实测 "../../etc"、"/etc/hosts" 都被接受）。 */
export function isInsidePluginRoot(pluginRoot: string, target: string): boolean {
  const rel = relative(resolve(pluginRoot), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function parsePluginManifest(raw: string): PluginManifest {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error('plugin manifest field "name" is required');
  }

  if (typeof parsed.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(parsed.name)) {
    throw new Error('plugin manifest field "name" is required and must use lowercase letters, numbers, or hyphens');
  }
  if (typeof parsed.version !== "string" || !SEMVER_PATTERN.test(parsed.version)) {
    throw new Error('plugin manifest field "version" is required and must be a semantic version');
  }

  const description = optionalString(parsed, "description");
  const minKunpengVersion = optionalString(parsed, "minKunpengVersion");
  const skillsDir = optionalString(parsed, "skillsDir");
  const mcpConfig = optionalString(parsed, "mcpConfig");
  const agentsDir = optionalString(parsed, "agentsDir");
  const hooksConfig = optionalString(parsed, "hooksConfig");
  const workflowsDir = optionalString(parsed, "workflowsDir");

  return {
    name: parsed.name,
    version: parsed.version,
    ...(description === undefined ? {} : { description }),
    ...(minKunpengVersion === undefined ? {} : { minKunpengVersion }),
    ...(skillsDir === undefined ? {} : { skillsDir }),
    ...(mcpConfig === undefined ? {} : { mcpConfig }),
    ...(agentsDir === undefined ? {} : { agentsDir }),
    ...(hooksConfig === undefined ? {} : { hooksConfig }),
    ...(workflowsDir === undefined ? {} : { workflowsDir }),
  };
}

function currentKunpengVersion(): string {
  try {
    const packageJson: unknown = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    if (isRecord(packageJson) && typeof packageJson.version === "string") {
      return packageJson.version;
    }
  } catch {
    // A missing or unreadable package manifest is treated as the oldest version.
  }
  return "0.0.0";
}

export function checkMinVersion(
  manifest: PluginManifest,
  current?: string,
): { ok: boolean; reason?: string } {
  const minimum = manifest.minKunpengVersion;
  if (minimum === undefined) {
    return { ok: true };
  }

  const currentVersion = current ?? currentKunpengVersion();
  if (compareSemver(currentVersion, minimum) >= 0) return { ok: true };

  return {
    ok: false,
    reason: `需鲲鹏 >= ${minimum}，当前 ${currentVersion}`,
  };
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function discoverSkillDirs(skillsRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(skillsRoot, entry.name))
    .sort();

  const skillDirs = await Promise.all(
    candidates.map(async (candidate): Promise<string | undefined> => {
      try {
        const metadata = await stat(resolve(candidate, "SKILL.md"));
        return metadata.isFile() ? candidate : undefined;
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    }),
  );

  return skillDirs.filter((candidate): candidate is string => candidate !== undefined);
}

async function validateMcpConfig(path: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid MCP config at ${path}`, { cause: error });
  }

  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    throw new Error(`MCP config at ${path} must contain an mcpServers object`);
  }
  return path;
}

async function discoverFiles(dir: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => resolve(dir, entry.name))
      .sort();
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

async function loadHooksConfig(path: string): Promise<PluginHooks | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid hooks config at ${path}`, { cause: error });
  }
  if (!isRecord(parsed)) throw new Error(`hooks config at ${path} must be an object`);
  for (const [key, commands] of Object.entries(parsed)) {
    if (!PLUGIN_HOOK_EVENTS.some((event) => event === key)) {
      throw new Error(`unknown hook event "${key}" (allowed: preMerge, sessionStart)`);
    }
    if (!Array.isArray(commands) || !commands.every((command) => typeof command === "string" && command.trim().length > 0)) {
      throw new Error(`"${key}" must be an array of non-empty command strings`);
    }
  }
  return parsed as PluginHooks;
}

export async function loadPluginDir(dir: string): Promise<LoadedPlugin> {
  const pluginRoot = resolve(dir);
  const manifestPath = resolve(pluginRoot, "kunpeng-plugin.json");

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`missing kunpeng-plugin.json at ${manifestPath}`, { cause: error });
    }
    throw error;
  }

  const manifest = parsePluginManifest(manifestRaw);
  const skillsRoot = resolve(pluginRoot, manifest.skillsDir ?? "skills");
  const mcpConfigPath = resolve(pluginRoot, manifest.mcpConfig ?? ".mcp.json");
  const agentsRoot = resolve(pluginRoot, manifest.agentsDir ?? "agents");
  const hooksConfigPath = resolve(pluginRoot, manifest.hooksConfig ?? "hooks.json");
  const workflowsRoot = resolve(pluginRoot, manifest.workflowsDir ?? "workflows");
  if (!isInsidePluginRoot(pluginRoot, skillsRoot)) {
    throw new Error(`plugin manifest field "skillsDir" must stay inside the plugin directory: ${manifest.skillsDir}`);
  }
  if (!isInsidePluginRoot(pluginRoot, mcpConfigPath)) {
    throw new Error(`plugin manifest field "mcpConfig" must stay inside the plugin directory: ${manifest.mcpConfig}`);
  }
  if (!isInsidePluginRoot(pluginRoot, agentsRoot)) {
    throw new Error(`plugin manifest field "agentsDir" must stay inside the plugin directory: ${manifest.agentsDir}`);
  }
  if (!isInsidePluginRoot(pluginRoot, hooksConfigPath)) {
    throw new Error(`plugin manifest field "hooksConfig" must stay inside the plugin directory: ${manifest.hooksConfig}`);
  }
  if (!isInsidePluginRoot(pluginRoot, workflowsRoot)) {
    throw new Error(`plugin manifest field "workflowsDir" must stay inside the plugin directory: ${manifest.workflowsDir}`);
  }
  const [skillDirs, mcpPath, agentFiles, workflowFiles, hooks] = await Promise.all([
    discoverSkillDirs(skillsRoot),
    validateMcpConfig(mcpConfigPath),
    discoverFiles(agentsRoot, ".role.md"),
    discoverFiles(workflowsRoot, ".md"),
    loadHooksConfig(hooksConfigPath),
  ]);

  return {
    manifest,
    skillDirs,
    agentFiles,
    workflowFiles,
    ...(mcpPath === undefined ? {} : { mcpPath }),
    ...(hooks === undefined ? {} : { hooksPath: hooksConfigPath, hooks }),
  };
}
