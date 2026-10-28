import { renderSkeleton } from "./repo-map.js";

type SourceFile = { path: string; source: string };

const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g;
const BACKTICK_RE = /`([^`]*)`/g;
const TS_PATH_RE = /[\w./-]*\.tsx?\b/g;

export function extractFocusSymbols(requirement: string): string[] {
  const symbols: string[] = [];
  const seen = new Set<string>();

  const push = (symbol: string) => {
    if (!seen.has(symbol)) {
      seen.add(symbol);
      symbols.push(symbol);
    }
  };

  for (const match of requirement.matchAll(BACKTICK_RE)) {
    const inner = match[1] ?? "";
    for (const id of inner.matchAll(IDENTIFIER_RE)) {
      const symbol = id[0];
      if (symbol.length >= 2) {
        push(symbol);
      }
    }
  }

  for (const match of requirement.matchAll(IDENTIFIER_RE)) {
    const symbol = match[0];
    if (symbol.length >= 3 && /[A-Z_]/.test(symbol)) {
      push(symbol);
    }
  }

  return symbols;
}

export function extractPathTerms(requirement: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const term = raw.toLowerCase();
    if (!term || seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  };

  for (const match of requirement.matchAll(TS_PATH_RE)) {
    const path = match[0];
    const base = path.slice(path.lastIndexOf("/") + 1);
    const stem = base.replace(/\.tsx?$/i, "");
    push(stem);
    for (const part of stem.split(/[^A-Za-z0-9]+/)) {
      if (part.length >= 3) {
        push(part);
      }
    }
  }

  return terms;
}

export function buildRepoMapContext(
  files: SourceFile[],
  requirement: string,
  opts?: { maxChars?: number },
): string {
  if (files.length === 0) {
    return "";
  }

  const focus = [...extractFocusSymbols(requirement), ...extractPathTerms(requirement)];
  const skel = renderSkeleton(files, { focusSymbols: focus, maxChars: opts?.maxChars ?? 2000 });
  if (skel.trim().length === 0) {
    return "";
  }

  return `## 现有代码地图（相关优先）\n${skel}`;
}
