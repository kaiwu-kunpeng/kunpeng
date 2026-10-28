import { posix } from "node:path";

export interface FileSymbols {
  exports: string[];
  importFroms: string[];
}

export interface SymbolNode {
  path: string;
  exports: string[];
  refs: number;
}

export interface RankedFile {
  path: string;
  refs: number;
  exports: number;
}

const IDENT = "[A-Za-z_$][\\w$]*";

function pushUnique(items: string[], item: string): void {
  if (!items.includes(item)) {
    items.push(item);
  }
}

export function extractFileSymbols(source: string): FileSymbols {
  const exports: string[] = [];
  const importFroms: string[] = [];

  for (const match of source.matchAll(new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+(${IDENT})\\b`, "g"))) {
    pushUnique(exports, match[1]);
  }
  for (const match of source.matchAll(new RegExp(`\\bexport\\s+(?:const|let|var)\\s+(${IDENT})\\b`, "g"))) {
    pushUnique(exports, match[1]);
  }
  for (const match of source.matchAll(new RegExp(`\\bexport\\s+(?:class|interface|type|enum)\\s+(${IDENT})\\b`, "g"))) {
    pushUnique(exports, match[1]);
  }
  if (/\bexport\s+default\b/.test(source)) {
    pushUnique(exports, "default");
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}(?:\s+from\s+["'][^"']+["'])?/g)) {
    for (const rawPart of match[1].split(",")) {
      const part = rawPart.trim();
      if (!part) {
        continue;
      }
      const alias = new RegExp(`^(?:${IDENT})\\s+as\\s+(${IDENT})$`).exec(part);
      const bare = new RegExp(`^(${IDENT})$`).exec(part);
      if (alias) {
        pushUnique(exports, alias[1]);
      } else if (bare) {
        pushUnique(exports, bare[1]);
      }
    }
  }

  for (const match of source.matchAll(/\bimport\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
    pushUnique(importFroms, match[1]);
  }

  return { exports, importFroms };
}

function normalizeModulePath(path: string): string {
  return path.replace(/\.(?:ts|tsx|js|mjs|cjs)$/, "").replace(/\/index$/, "");
}

export function buildSymbolGraph(files: { path: string; source: string }[]): { nodes: SymbolNode[] } {
  const symbols = files.map((file) => extractFileSymbols(file.source));
  const nodes = files.map((file, index) => ({
    path: file.path,
    exports: symbols[index].exports,
    refs: 0,
  }));
  const nodeByNormalizedPath = new Map<string, number>();

  files.forEach((file, index) => {
    nodeByNormalizedPath.set(normalizeModulePath(file.path), index);
  });

  files.forEach((file, sourceIndex) => {
    const targets = new Set<number>();
    const sourcePath = normalizeModulePath(file.path);

    for (const spec of symbols[sourceIndex].importFroms) {
      if (!spec.startsWith(".")) {
        continue;
      }
      const targetPath = normalizeModulePath(posix.normalize(posix.join(posix.dirname(file.path), spec)));
      const targetIndex = nodeByNormalizedPath.get(targetPath);
      if (targetIndex !== undefined && targetPath !== sourcePath) {
        targets.add(targetIndex);
      }
    }

    for (const targetIndex of targets) {
      nodes[targetIndex].refs += 1;
    }
  });

  return { nodes };
}

export function rankFiles(files: { path: string; source: string }[]): RankedFile[] {
  return buildSymbolGraph(files)
    .nodes.map((node) => ({
      path: node.path,
      refs: node.refs,
      exports: node.exports.length,
    }))
    .sort((a, b) => b.refs - a.refs || exportRankWeight(b.exports) - exportRankWeight(a.exports) || a.path.localeCompare(b.path));
}

function exportRankWeight(count: number): number {
  return Math.max(0, count - 1);
}
