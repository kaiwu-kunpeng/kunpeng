import type { CodeNode } from "./types.js";

type SearchStore = {
  search(query: string): CodeNode[];
};

type ContextGraph = {
  buildContext(query: string, maxNodes?: number): string;
};

export type SavingsEstimate = {
  query: string;
  nodes: number;
  hitNodes: number;
  fileCount: number;
  focusedTokens: number;
  baselineTokens: number;
  savedTokens: number;
  savedRatio: number;
};

export type EstimateQuerySavingsArgs = {
  store: SearchStore;
  graph: ContextGraph;
  query: string;
  sizeOf(file: string): number;
  maxNodes?: number;
};

const DEFAULT_MAX_NODES = 10;

export function estimateQuerySavings(args: EstimateQuerySavingsArgs): SavingsEstimate {
  const maxNodes = args.maxNodes ?? DEFAULT_MAX_NODES;
  const nodes = args.store.search(args.query).slice(0, maxNodes);
  const focusedContext = args.graph.buildContext(args.query, maxNodes);
  const files = new Set(nodes.map((node) => node.file));

  let baselineChars = 0;
  for (const file of files) {
    baselineChars += Math.max(0, args.sizeOf(file));
  }

  const focusedTokens = charsToTokens(focusedContext.length);
  const baselineTokens = charsToTokens(baselineChars);
  const savedTokens = Math.max(0, baselineTokens - focusedTokens);

  return {
    query: args.query,
    nodes: nodes.length,
    hitNodes: nodes.length,
    fileCount: files.size,
    focusedTokens,
    baselineTokens,
    savedTokens,
    savedRatio: baselineTokens > 0 ? savedTokens / baselineTokens : 0,
  };
}

export function formatSavings(estimate: SavingsEstimate): string {
  const percent = (estimate.savedRatio * 100).toFixed(1);
  return [
    "省 token 估算（上界估算，非精确实测）",
    `query: ${estimate.query}`,
    `命中节点数: ${estimate.hitNodes}`,
    `文件数: ${estimate.fileCount}`,
    `聚焦 token: ${estimate.focusedTokens}`,
    `全读 token: ${estimate.baselineTokens}`,
    `节省 token: ${estimate.savedTokens}`,
    `省 ~${percent}%`,
  ].join("\n");
}

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
