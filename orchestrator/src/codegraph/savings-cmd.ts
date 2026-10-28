import { statSync } from "node:fs";
import { join } from "node:path";
import { CodeGraph } from "./graph.js";
import { loadGraphStore } from "./serve-cmd.js";
import { estimateQuerySavings, formatSavings, type SavingsEstimate } from "./savings.js";

export function runCodegraphSavings(repoRoot: string, query: string): SavingsEstimate {
  const store = loadGraphStore(repoRoot);
  const graph = new CodeGraph(store);
  const estimate = estimateQuerySavings({
    store,
    graph,
    query,
    sizeOf: (file) => safeFileSize(join(repoRoot, file)),
  });

  console.log(formatSavings(estimate));
  return estimate;
}

function safeFileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
