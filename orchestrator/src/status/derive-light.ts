import type { Light } from "./types.js";

/** 灯规则:红=接线失败或最近报错;黄=接线但没成功过/陈旧/有待办;绿=接线+近期成功;idle=接线但零活动。 */
export function deriveLight(input: {
  wired: boolean;
  hasActivity: boolean;
  lastOk?: boolean;
  pending?: number;
  stale?: boolean;
}): Light {
  if (!input.wired) return "red";
  if (input.lastOk === false) return "red";
  if (!input.hasActivity) return "idle";
  if (input.stale || (input.pending ?? 0) > 0) return "yellow";
  return "green";
}

/** 相对时间:复用 state.ts 的 relTime 语义但本文件自给(避免跨依赖)。入参为「距今毫秒」。 */
export function agoText(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}
