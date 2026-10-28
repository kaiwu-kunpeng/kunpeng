export function extractTokensUsed(text: string): number | undefined {
  const re = /tokens used[^\d]*([\d,]+)/gi;
  let last: string | undefined;

  for (const match of text.matchAll(re)) {
    last = match[1];
  }

  if (!last) return undefined;

  const normalized = last.replace(/[,\s]/g, "");
  const value = Number.parseInt(normalized, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
