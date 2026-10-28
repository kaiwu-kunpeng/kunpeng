import { extractFocusSymbols, extractPathTerms } from "./spec-context.js";

function uniqueLowerTerms(requirement: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const raw of [...extractFocusSymbols(requirement), ...extractPathTerms(requirement)]) {
    const term = raw.toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return terms;
}

export function selectRelevantPaths(paths: string[], requirement: string, cap: number): string[] {
  if (cap <= 0) {
    return [];
  }

  const terms = uniqueLowerTerms(requirement);
  const ranked = paths.map((path, index) => {
    const lowerPath = path.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lowerPath.includes(term) ? 1 : 0), 0);
    return { path, index, score };
  });

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, cap).map((item) => item.path);
}
