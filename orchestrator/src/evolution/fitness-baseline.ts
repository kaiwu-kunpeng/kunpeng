import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FitnessSnapshot } from "./fitness.js";

/** 全零快照：无 baseline 时的对照起点（首轮 Δ = 当前 vs 零）。 */
export const ZERO_FITNESS: FitnessSnapshot = { netSavedHours: 0, verifiedDevFlows: 0, totalUsd: 0, totalTokens: 0 };

/** 真适应度 baseline 持久层：存上一轮系统快照，供下一轮算纵向 Δ（真趋势，非一次性快照）。 */
export class FitnessBaselineStore {
  constructor(private readonly filePath: string) {}

  /** 读上一轮 baseline；不存在 / 解析失败 → null。 */
  async load(): Promise<FitnessSnapshot | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FitnessSnapshot>;
      if (typeof parsed?.netSavedHours !== "number") return null;
      return {
        netSavedHours: parsed.netSavedHours,
        verifiedDevFlows: parsed.verifiedDevFlows ?? 0,
        totalUsd: parsed.totalUsd ?? 0,
        totalTokens: parsed.totalTokens ?? 0,
      };
    } catch {
      return null;
    }
  }

  /** 把当前快照落为新 baseline（原子写：tmp+rename 由 writeFile 简化，目录自建）。 */
  async save(snapshot: FitnessSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(snapshot), "utf8");
  }
}
