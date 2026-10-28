import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { FlowState, FlowTracker } from "../runtime/flowstate.js";
import { isAggregateFlowId } from "../objects/flow-metrics.js";

export function isReceiptCovered(flow: Pick<FlowState, "tokensUsed" | "tokenQuad">): boolean {
  return (flow.tokensUsed ?? 0) > 0 || (flow.tokenQuad?.input ?? 0) + (flow.tokenQuad?.output ?? 0) > 0;
}

export function receiptCoverage(flows: readonly FlowState[]): { total: number; covered: number; missing: string[]; aggregates: number; pct: number } {
  let total = 0;
  let covered = 0;
  let aggregates = 0;
  const missing: string[] = [];
  for (const flow of flows) {
    if (flow.status !== "verified" && flow.status !== "rolled-back") continue;
    if (isAggregateFlowId(flow.flowId)) {
      aggregates++;
      continue;
    }
    total++;
    if (isReceiptCovered(flow)) covered++;
    else missing.push(flow.flowId);
  }
  return { total, covered, missing: missing.sort(), aggregates, pct: total === 0 ? 0 : Math.round(covered / total * 1000) / 10 };
}

export function claudeProjectDirName(worktreePath: string): string {
  return worktreePath.replace(/[^A-Za-z0-9]/g, "-");
}

export interface SessionUsage {
  backend: "codex" | "claude";
  sessionId?: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  source: "codex-session" | "claude-transcript";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function* codexRollouts(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* codexRollouts(path);
    else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) yield path;
  }
}

export function findSessionUsage(
  flow: Pick<FlowState, "flowId" | "stageSessions">,
  opts: { repoRoot: string; codexHome: string; claudeDir: string },
): SessionUsage | null {
  const worktree = join(opts.repoRoot, ".kunpeng", "wt", flow.flowId);
  const wanted = new Set(Object.values(flow.stageSessions ?? {}).map((s) => s.sessionId));
  const codex: SessionUsage = { backend: "codex", source: "codex-session", input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  let codexMatched = false;
  for (const path of codexRollouts(join(opts.codexHome, "sessions"))) {
    let lines: string[];
    try {
      lines = readFileSync(path, "utf8").split("\n");
    } catch {
      continue;
    }
    const meta = parseLine(lines[0] ?? "");
    const payload = record(meta?.payload);
    if (meta?.type !== "session_meta" || !payload) continue;
    if (payload.cwd !== worktree && !(typeof payload.session_id === "string" && wanted.has(payload.session_id))) continue;
    codexMatched = true;
    let lastUsage: Record<string, unknown> | undefined;
    for (const line of lines.slice(1)) {
      const event = parseLine(line);
      const eventPayload = record(event?.payload);
      if (event?.type !== "event_msg" || eventPayload?.type !== "token_count") continue;
      const usage = record(record(eventPayload.info)?.total_token_usage);
      if (usage) lastUsage = usage;
    }
    if (lastUsage) {
      const cached = numberField(lastUsage.cached_input_tokens);
      codex.input += Math.max(0, numberField(lastUsage.input_tokens) - cached);
      codex.output += numberField(lastUsage.output_tokens);
      codex.cacheCreate += numberField(lastUsage.cache_write_input_tokens);
      codex.cacheRead += cached;
    }
  }
  if (codexMatched) return codex;

  const projectDir = join(opts.claudeDir, "projects", claudeProjectDirName(worktree));
  let files: string[];
  try {
    files = readdirSync(projectDir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return null;
  }
  const claude: SessionUsage = { backend: "claude", source: "claude-transcript", input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  let claudeMatched = false;
  for (const file of files) {
    let lines: string[];
    try {
      lines = readFileSync(join(projectDir, file), "utf8").split("\n");
    } catch {
      continue;
    }
    for (const line of lines) {
      const entry = parseLine(line);
      if (entry?.type !== "assistant") continue;
      const usage = record(record(entry.message)?.usage);
      if (!usage) continue;
      claudeMatched = true;
      claude.input += numberField(usage.input_tokens);
      claude.output += numberField(usage.output_tokens);
      claude.cacheCreate += numberField(usage.cache_creation_input_tokens);
      claude.cacheRead += numberField(usage.cache_read_input_tokens);
    }
  }
  return claudeMatched ? claude : null;
}

export async function backfillReceipts(
  tracker: FlowTracker,
  opts: { repoRoot: string; codexHome?: string; claudeDir?: string; dryRun?: boolean },
): Promise<{ scanned: number; filled: number; notFound: string[]; entries: { flowId: string; source: string; input: number; output: number }[] }> {
  const codexHome = opts.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const claudeDir = opts.claudeDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const flows = await tracker.list();
  const missing = receiptCoverage(flows).missing;
  const byId = new Map(flows.map((flow) => [flow.flowId, flow]));
  const notFound: string[] = [];
  const entries: { flowId: string; source: string; input: number; output: number }[] = [];
  let filled = 0;
  for (const flowId of missing) {
    const usage = findSessionUsage(byId.get(flowId)!, { repoRoot: opts.repoRoot, codexHome, claudeDir });
    if (!usage) {
      notFound.push(flowId);
      continue;
    }
    const { source, input, output, cacheCreate, cacheRead } = usage;
    entries.push({ flowId, source, input, output });
    if (!opts.dryRun) {
      await tracker.addTokenQuad(flowId, { input, output, cacheCreate, cacheRead });
      await tracker.addTokens(flowId, input + output);
      await tracker.setReceiptSource(flowId, "backfill");
      filled++;
    }
  }
  return { scanned: missing.length, filled, notFound, entries };
}

export function renderReceiptReport(cov: ReturnType<typeof receiptCoverage>): string {
  const lines = [
    `收据覆盖率 ${cov.pct}%（${cov.covered}/${cov.total}，plan/igate 聚合流 ${cov.aggregates} 条不计分母）`,
    ...cov.missing.slice(0, 20).map((flowId) => `  ${flowId}`),
  ];
  if (cov.missing.length > 20) lines.push(`  +${cov.missing.length - 20} more`);
  return lines.join("\n");
}
