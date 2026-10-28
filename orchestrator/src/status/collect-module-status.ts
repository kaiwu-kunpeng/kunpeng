import { MODULE_REGISTRY } from "./module-registry.js";
import type { ModuleStatusReport, StatusContext } from "./types.js";

export function collectModuleStatus(ctx: StatusContext): ModuleStatusReport {
  const modules = MODULE_REGISTRY.map((m) => m.derive(ctx));
  const rollup = { green: 0, yellow: 0, red: 0, idle: 0 };
  for (const m of modules) rollup[m.light]++;
  return { modules, rollup, generatedAt: ctx.now };
}
