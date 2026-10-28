export interface BilledUsage {
  input?: number;
  output?: number;
  cacheCreate?: number;
  cacheRead?: number;
}

/** 唯一的「计费 token」定义（flow 与 chat 共用）。cache_create×1.25、cache_read×0.1 计入。
 *  任一字段缺失/非有限数按 0；结果 Math.round 取整、非负、永不 NaN。
 *  无 cache 字段时结果 = input + output（向后兼容）。 */
export function effectiveBilledTokens(u: BilledUsage): number {
  const total =
    safeToken(u.input) +
    safeToken(u.output) +
    Math.round(safeToken(u.cacheCreate) * 1.25 + safeToken(u.cacheRead) * 0.1);
  return Math.max(0, Math.round(total));
}

function safeToken(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
