import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autonomyKpiProvider } from "./kpi-autonomy.js";
import { commandKpiProvider } from "./kpi-command.js";
import type { KpiProvider } from "./product-kpi.js";

// 产品自身使用自治度 KPI；项目专属 provider 由状态目录配置注入。
const REGISTRY: Record<string, KpiProvider> = {
  kunpeng: autonomyKpiProvider,
};

interface ProjectKpiProviderConfig {
  command: string;
  key: string;
  label: string;
  higherBetter: boolean;
}

function isProjectKpiProviderConfig(
  value: unknown,
): value is ProjectKpiProviderConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const config = value as Record<string, unknown>;
  return typeof config.command === "string"
    && typeof config.key === "string"
    && typeof config.label === "string"
    && typeof config.higherBetter === "boolean";
}

export function loadProjectKpiProviders(
  stateDir: string,
): Record<string, KpiProvider> {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(stateDir, "kpi-providers.json"), "utf8"),
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const providers: Record<string, KpiProvider> = {};
    for (const [projectId, config] of Object.entries(parsed)) {
      if (projectId.trim() === "" || !isProjectKpiProviderConfig(config)) {
        return {};
      }
      providers[projectId] = commandKpiProvider(config);
    }
    return providers;
  } catch {
    return {};
  }
}

export function resolveKpiProvider(
  projectId?: string,
  extra?: Record<string, KpiProvider>,
): KpiProvider {
  if (projectId && extra?.[projectId]) return extra[projectId];
  if (projectId && REGISTRY[projectId]) return REGISTRY[projectId];
  return autonomyKpiProvider;
}
