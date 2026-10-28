import { buildSymbolGraph, rankFiles, type RankedFile } from "./symbol-index.js";

export interface RelevantFile {
  path: string;
  refs: number;
  exports: number;
  relevance: number;
}

type SourceFile = { path: string; source: string };

export function queryRelevant(files: SourceFile[], targetSymbols: string[]): RelevantFile[] {
  const graph = buildSymbolGraph(files);
  const targets = new Set(targetSymbols);
  const normalizedTargets = targetSymbols.map((target) => target.toLowerCase());
  const targetExportPaths = new Set(
    graph.nodes.filter((node) => node.exports.some((name) => targets.has(name))).map((node) => node.path),
  );

  return graph.nodes
    .map((node, index) => {
      const exportsTarget = node.exports.some((name) => targets.has(name));
      const fuzzyTarget = !exportsTarget && exportsAnyFuzzyTarget(node.exports, normalizedTargets);
      const pathTarget = pathContainsTarget(node.path, normalizedTargets);
      const importsTarget = importsAnyTarget(files[index], files, targetExportPaths);

      return {
        path: node.path,
        refs: node.refs,
        exports: node.exports.length,
        relevance: (exportsTarget ? 2 : 0) + (fuzzyTarget ? 1 : 0) + (pathTarget ? 1 : 0) + (importsTarget ? 1 : 0),
      };
    })
    .sort((a, b) => b.relevance - a.relevance || b.refs - a.refs || a.path.localeCompare(b.path));
}

export function renderSkeleton(
  files: SourceFile[],
  opts?: { maxChars?: number; focusSymbols?: string[] },
): string {
  const maxChars = opts?.maxChars ?? 4000;
  const ranked: RelevantFile[] | RankedFile[] = opts?.focusSymbols?.length
    ? queryRelevant(files, opts.focusSymbols)
    : rankFiles(files);
  const graph = buildSymbolGraph(files);
  const nodeByPath = new Map(graph.nodes.map((node) => [node.path, node]));
  const blocks: string[] = [];
  let used = 0;

  for (const file of ranked) {
    const node = nodeByPath.get(file.path);
    if (!node) {
      continue;
    }

    const block = [node.path, ...node.exports.map((name) => `  · ${name}`)].join("\n");
    if (blocks.length > 0 && used + block.length > maxChars) {
      break;
    }

    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n");
}

function importsAnyTarget(file: SourceFile, files: SourceFile[], targetExportPaths: Set<string>): boolean {
  if (targetExportPaths.size === 0) {
    return false;
  }

  for (const targetFile of files) {
    if (!targetExportPaths.has(targetFile.path)) {
      continue;
    }

    const graph = buildSymbolGraph([file, targetFile]);
    const targetNode = graph.nodes.find((node) => node.path === targetFile.path);
    if (targetNode && targetNode.refs > 0) {
      return true;
    }
  }

  return false;
}

function exportsAnyFuzzyTarget(exports: string[], targets: string[]): boolean {
  return exports.some((name) => {
    const exportName = name.toLowerCase();
    if (exportName.length < 4) return false;
    return targets.some((target) => (
      target.length >= 4
      && exportName !== target
      && (exportName.includes(target) || target.includes(exportName))
    ));
  });
}

function pathContainsTarget(path: string, targets: string[]): boolean {
  const lowerPath = path.toLowerCase();
  return targets.some((target) => target.length >= 3 && lowerPath.includes(target));
}
