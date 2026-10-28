import type { Capture } from "./capture-store.js";

// 零写状态的"温故"挑选:越旧越优先、未 promote 优先;按 dayKey 轮换不同切片。
// dayKey 由调用方传(= floor(now/86400000)),纯函数可测。
export function pickResurfacing(captures: Capture[], dayKey: number, limit = 5): Capture[] {
  if (captures.length === 0) return [];
  const ranked = [...captures].sort((a, b) => {
    if (a.promoted !== b.promoted) return a.promoted ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });
  const n = ranked.length;
  const take = Math.min(limit, n);
  const offset = ((dayKey % n) + n) % n;
  const out: Capture[] = [];
  for (let i = 0; i < take; i++) out.push(ranked[(offset + i) % n]);
  return out;
}
