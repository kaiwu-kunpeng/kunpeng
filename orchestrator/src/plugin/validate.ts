import { errorMessage } from "../util/errors.js";
import {
  PLUGIN_CONTRIBUTION_KINDS,
  checkMinVersion,
  loadPluginDir,
  type LoadedPlugin,
  type PluginContributionKind,
} from "./manifest.js";

export interface PluginValidationReport {
  ok: boolean;
  strict: boolean;
  errors: string[];
  warnings: string[];
  contributions: Record<PluginContributionKind, number>;
  loaded?: LoadedPlugin;
}

export async function validatePlugin(
  dir: string,
  { strict = false, currentVersion }: { strict?: boolean; currentVersion?: string } = {},
): Promise<PluginValidationReport> {
  const report: PluginValidationReport = {
    ok: false,
    strict,
    errors: [],
    warnings: [],
    contributions: { skills: 0, agents: 0, hooks: 0, mcp: 0, workflows: 0 },
  };
  let loaded: LoadedPlugin;
  try {
    loaded = await loadPluginDir(dir);
  } catch (error) {
    report.errors.push(errorMessage(error));
    return report;
  }
  report.loaded = loaded;

  const compatibility = checkMinVersion(loaded.manifest, currentVersion);
  if (!compatibility.ok) {
    report.errors.push(`minKunpengVersion 不满足：${compatibility.reason}`);
  }
  report.contributions = {
    skills: loaded.skillDirs.length,
    agents: loaded.agentFiles.length,
    hooks: Object.values(loaded.hooks ?? {}).reduce((sum, commands) => sum + commands.length, 0),
    mcp: loaded.mcpPath ? 1 : 0,
    workflows: loaded.workflowFiles.length,
  };

  if (!loaded.manifest.description?.trim()) {
    report.warnings.push("缺 description：建议说明插件用途");
  }
  if (!loaded.manifest.minKunpengVersion?.trim()) {
    report.warnings.push("缺 minKunpengVersion：建议声明最低兼容版本");
  }
  if (PLUGIN_CONTRIBUTION_KINDS.every((kind) => report.contributions[kind] === 0)) {
    report.warnings.push("空壳插件：skills / agents / hooks / mcp / workflows 一个都没有");
  }
  if (report.contributions.hooks > 0) {
    report.warnings.push(`带 ${report.contributions.hooks} 条 hooks（会跑 shell）：启用前须人工逐条审阅`);
  }
  report.ok = report.errors.length === 0 && (!strict || report.warnings.length === 0);
  return report;
}

export function renderPluginValidation(report: PluginValidationReport): string {
  const label = report.loaded
    ? `${report.loaded.manifest.name}@${report.loaded.manifest.version}`
    : "(manifest 未通过)";
  return [
    `${report.ok ? "✓" : "✗"} ${label}${report.strict ? " [strict]" : ""}`,
    `贡献: ${PLUGIN_CONTRIBUTION_KINDS.map((kind) => `${kind}=${report.contributions[kind]}`).join(" ")}`,
    ...report.errors.map((error) => `  错误: ${error}`),
    ...report.warnings.map((warning) => `  ${report.strict ? "错误(strict)" : "警告"}: ${warning}`),
  ].join("\n");
}
