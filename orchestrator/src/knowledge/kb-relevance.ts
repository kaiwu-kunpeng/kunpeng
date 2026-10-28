export interface RelevanceEntry {
  tags: string[];
  summary: string;
}

export function extractQueryTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  const pushTerm = (raw: string): void => {
    const term = raw.toLowerCase();
    if (seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  };

  for (const match of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const token = match[0];
    if (token.length >= 3 && (/[A-Z]/.test(token) || token.includes("_"))) {
      pushTerm(token);
    }
  }

  for (const match of text.matchAll(/[A-Za-z]{4,}/g)) {
    pushTerm(match[0]);
  }

  return terms;
}

export function scoreEntry(entry: RelevanceEntry, terms: string[]): number {
  const tags = entry.tags.map((tag) => tag.toLowerCase());
  const summary = entry.summary.toLowerCase();

  return terms.reduce((score, rawTerm) => {
    const term = rawTerm.toLowerCase();
    if (tags.some((tag) => tag.includes(term))) return score + 2;
    if (summary.includes(term)) return score + 1;
    return score;
  }, 0);
}

export function selectRelevant<T extends RelevanceEntry>(
  entries: T[],
  terms: string[],
  opts: { k: number; minScore: number },
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, terms) }))
    .filter((item) => item.score >= opts.minScore)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, opts.k))
    .map((item) => item.entry);
}
