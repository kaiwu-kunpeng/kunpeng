import { join } from "node:path";
import { ArtifactStore } from "../artifacts/store.js";
import { collectState } from "../server/state.js";
import type { ModuleStatus } from "../status/types.js";

/** 维护 loop 模块通道 live 源:读真模块注册表派生状态。适配器隔离 evolution→server 依赖;
 *  collectState 在不完整 repo 上可能抛 → 一律兜底返回数组、绝不抛。 */
export async function liveModuleStatuses(repoRoot: string): Promise<ModuleStatus[]> {
  try {
    const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
    const ds = await collectState(store, repoRoot);
    return ds.moduleStatus?.modules ?? [];
  } catch {
    return [];
  }
}
