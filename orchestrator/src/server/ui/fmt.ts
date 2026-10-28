export function stripMd(s: string): string {
  // 真实流状态文件存在 requirement 缺失的历史数据，展示层必须容错（2026-07-02 /api/today 500 教训）。
  if (typeof s !== "string") return "";
  return s
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*$/gm, "$1")
    .replace(/\[([^\]]+)\]\([^)]*$/gm, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replaceAll("![", "")
    .replaceAll("](", " ")
    .replaceAll("**", "")
    .replaceAll("__", "")
    .replaceAll("`", "")
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripInlineMd(s: string): string {
  return s
    .split("\n")
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*$/, "$1")
      .replace(/\[([^\]]+)\]\([^)]*$/, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replaceAll("![", "")
      .replaceAll("](", " ")
      .replaceAll("**", "")
      .replaceAll("__", "")
      .replaceAll("`", "")
      .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
      .replace(/[ \t]+/g, " ")
      .trim())
    .join("\n")
    .trim();
}

export function clip(s: string, max: number): string {
  const chars = Array.from(s);
  if (!Number.isFinite(max) || max <= 0) return "";
  if (chars.length <= max) return s;
  if (max === 1) return "…";
  return `${chars.slice(0, max - 1).join("")}…`;
}

export function relTime(epochMs: number, now = Date.now()): string {
  if (!Number.isFinite(epochMs) || epochMs > now) return "";

  const diff = now - epochMs;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;

  const date = new Date(epochMs);
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1_000) return String(n);

  const unit = n < 1_000_000 ? "k" : "M";
  const divisor = n < 1_000_000 ? 1_000 : 1_000_000;
  return `${(n / divisor).toFixed(1).replace(/\.0$/, "")}${unit}`;
}
