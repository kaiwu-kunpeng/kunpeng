/**
 * 把"提案列表 + 上次巡检时间"汇总成总控台需要的两个字段。
 * 纯函数：无副作用、不读写外部状态、不做时间本地化。
 */
export function summarizePatrol(
  proposals: readonly { readonly status: string }[],
  lastPatrolAt?: number,
): { pendingCount: number; lastRunText: string } {
  const pendingCount = proposals.filter((p) => p.status === "draft").length;
  const lastRunText =
    lastPatrolAt === undefined ? "尚未巡检" : `上次巡检 @${lastPatrolAt}`;
  return { pendingCount, lastRunText };
}
