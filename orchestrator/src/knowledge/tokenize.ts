const SEG = new Intl.Segmenter("zh", { granularity: "word" });

export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const s of SEG.segment(text)) {
    if (!s.isWordLike) continue;
    const t = s.segment.trim().toLowerCase();
    if (t) out.push(t);
  }
  return out;
}
