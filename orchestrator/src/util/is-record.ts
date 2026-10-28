/** 判定值是否为普通对象(排除 null 与数组)。类型守卫,收敛全库重复定义。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
