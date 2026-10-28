import { createInterface } from "node:readline";
import { neonRunner } from "../db/neon-runner.js";
import { handleSeoMcp, type JsonRpcRequest, type JsonRpcResponse, type SeoMcpDeps } from "./mcp-server.js";
import { builtinSeoTools } from "./tools.js";

const PARSE_ERROR: JsonRpcResponse = {
  jsonrpc: "2.0",
  id: null,
  error: { code: -32700, message: "Parse error" },
};

export async function runSeoMcpStdio(
  deps: SeoMcpDeps,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.trim() === "") continue;

    let req: unknown;
    try {
      req = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(PARSE_ERROR)}\n`);
      continue;
    }

    const res = await handleSeoMcp(req as JsonRpcRequest, deps);
    if (res !== null) {
      output.write(`${JSON.stringify(res)}\n`);
    }
  }
}

export function buildSeoServeDeps(repoRoot: string, env: NodeJS.ProcessEnv = process.env): SeoMcpDeps {
  return {
    tools: builtinSeoTools(),
    context: {
      repoRoot, fetchImpl: fetch, now: () => Date.now(),
      ...(env.NEON_DATABASE_URL?.trim() ? { sqlRunner: neonRunner(env.NEON_DATABASE_URL) } : {}),
    },
    allowDestructive: env.KUNPENG_SEO_ALLOW_DESTRUCTIVE === "1",
  };
}

export async function runSeoServe(repoRoot: string): Promise<void> {
  await runSeoMcpStdio(buildSeoServeDeps(repoRoot));
}
