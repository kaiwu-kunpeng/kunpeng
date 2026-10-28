import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface BackendConfig {
  /** 每阶段走哪个后端(stage → backend name)。 */
  routing: Record<string, string>;
  /** 启用的后端名(供路由 fallback/可用性用)。 */
  enabled: string[];
}

/** 缺省=现状(与 STAGE_BACKEND 一致):只有写代码用 codex,其余 claude。 */
export const DEFAULT_BACKEND_CONFIG: BackendConfig = {
  routing: {
    spec: "claude",
    design: "claude",
    implement: "codex",
    review: "claude",
    verify: "claude",
    audit: "claude",
  },
  enabled: ["claude", "codex"],
};

export function normalizeBackendConfigInput(raw: unknown): BackendConfig {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const rawRouting = obj.routing && typeof obj.routing === "object" && !Array.isArray(obj.routing)
    ? obj.routing as Record<string, unknown>
    : {};
  const routing: Record<string, string> = { ...DEFAULT_BACKEND_CONFIG.routing };
  for (const stage of Object.keys(DEFAULT_BACKEND_CONFIG.routing)) {
    const value = rawRouting[stage];
    if (typeof value === "string" && value.trim()) {
      routing[stage] = value.trim();
    }
  }
  const rawEnabled = obj.enabled;
  const enabled = Array.isArray(rawEnabled) && rawEnabled.length > 0 && rawEnabled.every((item) => typeof item === "string" && item.trim())
    ? rawEnabled.map((item) => item.trim())
    : [...DEFAULT_BACKEND_CONFIG.enabled];
  return { routing, enabled };
}

export async function saveBackendConfig(repoRoot: string, raw: unknown): Promise<BackendConfig> {
  const config = normalizeBackendConfigInput(raw);
  const path = join(repoRoot, ".kunpeng", "backends.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), "utf8");
  return config;
}

/**
 * 读 `.kunpeng/backends.json` 合并到缺省之上(浅合并:配置里给了的覆盖,没给的用缺省)。
 * 文件缺失/坏档/字段类型不对 → 整体回退缺省(韧性优先,绝不因配置坏掉而无后端可用)。
 * 配置形状(全可选):{ "routing": { "implement": "codex", ... }, "enabled": ["claude","codex","qwen"] }
 */
export async function loadBackendConfig(path: string): Promise<BackendConfig> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<BackendConfig>;
    const routing = (raw.routing && typeof raw.routing === "object" && !Array.isArray(raw.routing))
      ? { ...DEFAULT_BACKEND_CONFIG.routing, ...raw.routing }
      : { ...DEFAULT_BACKEND_CONFIG.routing };
    const enabled = Array.isArray(raw.enabled) && raw.enabled.every((x) => typeof x === "string") && raw.enabled.length
      ? [...raw.enabled]
      : [...DEFAULT_BACKEND_CONFIG.enabled];
    return { routing, enabled };
  } catch {
    return { routing: { ...DEFAULT_BACKEND_CONFIG.routing }, enabled: [...DEFAULT_BACKEND_CONFIG.enabled] };
  }
}
