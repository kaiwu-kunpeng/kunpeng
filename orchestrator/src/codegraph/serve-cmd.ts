import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { bumpCall, emptyCallStats, formatCallStats } from "./call-stats.js";
import { handleCodegraphMcp, type JsonRpcResponse } from "./mcp-server.js";
import { CodeGraphStore } from "./store.js";
import { kunpengStateDir, readRegistry } from "../project/registry.js";
import { isNodeError } from "../util/errors.js";

const PARSE_ERROR: JsonRpcResponse = {
  jsonrpc: "2.0",
  id: null,
  error: { code: -32700, message: "Parse error" },
};

export function loadGraphStore(repoRoot: string): CodeGraphStore {
  try {
    return CodeGraphStore.fromJSON(readFileSync(join(repoRoot, ".kunpeng", "codegraph", "graph.json"), "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return new CodeGraphStore();
    }
    throw error;
  }
}

export async function runCodegraphMcpStdio(
  store: CodeGraphStore,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  stores?: Map<string, CodeGraphStore>,
): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  let stats = emptyCallStats();

  for await (const line of rl) {
    if (line.trim() === "") {
      continue;
    }

    let req: unknown;
    try {
      req = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(PARSE_ERROR)}\n`);
      continue;
    }

    const res = handleCodegraphMcp(req as Parameters<typeof handleCodegraphMcp>[0], {
      store,
      stores,
      recordCall: (tool) => {
        stats = bumpCall(stats, tool);
      },
    });
    if (res !== null) {
      output.write(`${JSON.stringify(res)}\n`);
    }
  }

  process.stderr.write(`[codegraph] calls: ${formatCallStats(stats)}\n`);
}

export async function runCodegraphServe(repoRoot: string): Promise<void> {
  const store = loadGraphStore(repoRoot);
  const stores = await loadProjectGraphStores();
  await runCodegraphMcpStdio(store, process.stdin, process.stdout, stores);
}

async function loadProjectGraphStores(): Promise<Map<string, CodeGraphStore>> {
  const stores = new Map<string, CodeGraphStore>();
  const projects = await readRegistry(kunpengStateDir()).catch(() => []);

  for (const project of projects) {
    try {
      stores.set(project.id, loadGraphStore(project.repoPath));
    } catch {
      continue;
    }
  }

  return stores;
}
