import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProductKpiSnapshot } from "./product-kpi.js";

/** B-KPI baseline 持久层：存上一轮产品 KPI 快照，供下一轮算纵向 Δ。与 A 的 FitnessBaselineStore 对称。 */
export class ProductKpiBaselineStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ProductKpiSnapshot | null> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<ProductKpiSnapshot>;
      if (typeof parsed?.value !== "number" || typeof parsed?.key !== "string") return null;
      return {
        key: parsed.key,
        label: parsed.label ?? parsed.key,
        value: parsed.value,
        higherBetter: parsed.higherBetter ?? true,
        ...(parsed.detail !== undefined && { detail: parsed.detail }),
      };
    } catch {
      return null;
    }
  }

  async save(snapshot: ProductKpiSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(snapshot), "utf8");
  }
}
