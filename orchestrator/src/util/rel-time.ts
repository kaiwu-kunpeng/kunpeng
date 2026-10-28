/** 毫秒差 → 中文相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）。通用格式化叶子，state 与各视图共享。 */
export function relTime(deltaMs: number): string {
  if (deltaMs < 60000) return "刚刚";
  if (deltaMs < 60 * 60000) return `${Math.floor(deltaMs / 60000)} 分钟前`;
  if (deltaMs < 24 * 60 * 60000) return `${Math.floor(deltaMs / (60 * 60000))} 小时前`;
  return `${Math.floor(deltaMs / (24 * 60 * 60000))} 天前`;
}
