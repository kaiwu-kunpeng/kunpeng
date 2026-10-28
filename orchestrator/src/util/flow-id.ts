/** 需求文本 → 文件系统/分支安全的 flow id（叶子模块，避免 server→cli.ts 反向依赖成环）。 */
export function makeFlowId(requirement: string, now: number): string {
  const slug = requirement.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
  return `${slug || "flow"}-${now.toString(36)}`;
}
