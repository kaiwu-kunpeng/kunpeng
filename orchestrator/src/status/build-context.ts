import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveCapturesDir } from "../knowledge/capture-store.js";
import { isServeOnline, readServeHeartbeat } from "./serve-heartbeat.js";
import type { StatusContext } from "./types.js";

export interface BuildContextInput {
  repoRoot: string;
  stateDir: string;
  now: number;
  truths: {
    flows: { status: string; stage: string; updatedAt: number; blocker?: string }[];
    health: { alerts: unknown[]; running: number; healthy: number };
    evolution?: { pendingCount: number; approvedCount: number; lastRunText: string };
    loops?: { id: string; name: string; waveCount: number }[];
    patrol?: { pendingCount: number; lastRunText: string };
    quota?: { total: number; accounts: { id: string }[] };
    branches: string[];
    lastMergeAt?: number;
  };
}

interface SwitchboardMessage {
  ts: number;
  from: string;
  read?: boolean;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function newestMtime(dir: string): Promise<number | undefined> {
  const names = await listDir(dir);
  const mtimes = await Promise.all(
    names.map(async (name) => {
      try {
        const s = await stat(join(dir, name));
        return Math.floor(s.mtimeMs);
      } catch {
        return undefined;
      }
    }),
  );
  const values = mtimes.filter((mtime): mtime is number => mtime !== undefined);
  if (values.length === 0) return undefined;
  return Math.max(...values);
}

async function existsDir(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function fileMtime(file: string): Promise<number | undefined> {
  try {
    return Math.floor((await stat(file)).mtimeMs);
  } catch {
    return undefined;
  }
}

function setIfNumber(record: Record<string, number>, key: string, value: number | undefined): void {
  if (value !== undefined) record[key] = value;
}

function parseSwitchboardMessage(value: unknown): SwitchboardMessage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { ts?: unknown; from?: unknown; read?: unknown };
  if (typeof candidate.ts !== "number" || typeof candidate.from !== "string") return undefined;
  return {
    ts: candidate.ts,
    from: candidate.from,
    ...(typeof candidate.read === "boolean" ? { read: candidate.read } : {}),
  };
}

async function readSwitchboard(sbDir: string): Promise<NonNullable<StatusContext["switchboard"]>> {
  const names = (await listDir(sbDir)).filter((name) => name.endsWith(".json"));
  const parsed = await Promise.all(
    names.map(async (name) => {
      try {
        return parseSwitchboardMessage(JSON.parse(await readFile(join(sbDir, name), "utf8")));
      } catch {
        return undefined;
      }
    }),
  );
  const messages = parsed.filter((message): message is SwitchboardMessage => message !== undefined);
  const unread = messages.filter((message) => message.read !== true).length;
  const latest = messages.reduce<SwitchboardMessage | undefined>((current, message) => {
    if (!current || message.ts > current.ts) return message;
    return current;
  }, undefined);
  if (!latest) return { unread };
  return { unread, lastAt: latest.ts, lastFrom: latest.from };
}

async function readJsonOrUndefined<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readNotify(stateDir: string): Promise<NonNullable<StatusContext["notify"]>> {
  const pushDir = join(stateDir, "push");
  const [configured, scan, last, heartbeat] = await Promise.all([
    readJsonOrUndefined<unknown>(join(stateDir, "notify.json")).then((value) => value !== undefined && value !== null && typeof value === "object"),
    readJsonOrUndefined<NonNullable<StatusContext["notify"]>["scan"]>(join(pushDir, "phone-scan.json")),
    readJsonOrUndefined<{ at?: unknown }>(join(pushDir, "phone-last.json")),
    readJsonOrUndefined<NonNullable<StatusContext["notify"]>["heartbeat"]>(join(pushDir, "channel-heartbeat.json")),
  ]);
  return {
    configured,
    ...(scan && typeof scan.at === "number" ? { scan } : {}),
    ...(typeof last?.at === "number" ? { lastSentAt: last.at } : {}),
    ...(heartbeat && typeof heartbeat.at === "number" ? { heartbeat } : {}),
  };
}

export async function buildStatusContext(input: BuildContextInput): Promise<StatusContext> {
  const { repoRoot, stateDir, now, truths } = input;
  const kp = join(repoRoot, ".kunpeng");
  const sbDir = join(stateDir, "switchboard");
  const capturesDir = resolveCapturesDir(repoRoot);
  const regressionDir = join(kp, "regression");
  const productDir = join(kp, "product");
  const previewsDir = join(kp, "previews");
  const artifactsDir = join(kp, "artifacts");
  const boardFile = join(kp, "board.json");
  const quotaFile = join(kp, "quota.json");

  const [
    captures,
    regression,
    product,
    previews,
    artifacts,
    switchboard,
    serveHeartbeat,
    agentsMtime,
    boardMtime,
    quotaMtime,
    capturesExists,
    regressionExists,
    productExists,
    previewsExists,
    switchboardExists,
    notify,
  ] = await Promise.all([
    newestMtime(capturesDir),
    newestMtime(regressionDir),
    newestMtime(productDir),
    newestMtime(previewsDir),
    newestMtime(artifactsDir),
    readSwitchboard(sbDir),
    readServeHeartbeat(stateDir),
    fileMtime(join(repoRoot, "AGENTS.md")),
    fileMtime(boardFile),
    fileMtime(quotaFile),
    existsDir(capturesDir),
    existsDir(regressionDir),
    existsDir(productDir),
    existsDir(previewsDir),
    existsDir(sbDir),
    readNotify(stateDir),
  ]);

  const artifactLatest: Record<string, number> = {};
  setIfNumber(artifactLatest, "url", captures);
  setIfNumber(artifactLatest, "text", captures);
  setIfNumber(artifactLatest, "pri", regression);
  setIfNumber(artifactLatest, "form", product);
  setIfNumber(artifactLatest, "design-selection", previews);
  setIfNumber(artifactLatest, "spec", artifacts);
  setIfNumber(artifactLatest, "plan", artifacts);
  setIfNumber(artifactLatest, "connector", artifacts);
  setIfNumber(artifactLatest, "network", artifacts);
  setIfNumber(artifactLatest, "merge", truths.lastMergeAt);

  const mtimes: Record<string, number> = {};
  setIfNumber(mtimes, "agents-md", agentsMtime);
  setIfNumber(mtimes, "board", boardMtime);

  const wired: Record<string, boolean> = {
    switchboard: switchboardExists,
    "knowledge-inbox": capturesExists,
    "evolution-flywheel": true,
    "perf-loop": regressionExists,
    "best-of-n": true,
    guardian: true,
    watchdog: true,
    patrol: true,
    "product-track": productExists,
    "merge-gate": true,
    "dev-cycle": true,
    "plan-orchestrator": true,
    "design-codegen": previewsExists,
    research: true,
    "security-review": true,
    compile: true,
    // quota 是 KUNPENG_HOME 级全局资产，不能用 repoRoot 探针判接线。
    usage: truths.quota !== undefined || quotaMtime !== undefined,
    board: boardMtime !== undefined,
    serve: true,
    notify: notify.configured,
  };

  return {
    now,
    wired,
    artifactCounts: {},
    artifactLatest,
    flows: truths.flows,
    health: truths.health,
    evolution: truths.evolution,
    loops: truths.loops,
    patrol: truths.patrol,
    quota: truths.quota,
    branches: truths.branches,
    switchboard,
    mtimes,
    notify,
    online: { switchboard: switchboardExists, serve: isServeOnline(serveHeartbeat, now), watchdog: false },
  };
}
