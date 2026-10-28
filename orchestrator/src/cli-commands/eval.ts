import { isRecord } from "../util/is-record.js";
import { exec } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../artifacts/store.js";
import { extractAcceptance } from "../plan/acceptance.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import {
  harvestGoldenTask,
  runGoldenSuite,
  type GoldenSuiteResult,
  type GoldenTask,
} from "../verify/regression-suite.js";
import { CliUsageError, registerCliCommand, type CliContext } from "./registry.js";

const EVAL_USAGE = "用法: kunpeng eval harvest <flowId> | run [--sample N] | report";

interface GoldenReport extends GoldenSuiteResult {
  generatedAt: number;
  sample?: number;
}

function evalDir(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "evals");
}

function goldenPath(repoRoot: string): string {
  return join(evalDir(repoRoot), "golden", "tasks.json");
}

function isGoldenTask(value: unknown): value is GoldenTask {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.requirement === "string"
    && typeof value.acceptCmd === "string"
    && typeof value.harvestedAt === "number"
    && Number.isFinite(value.harvestedAt);
}

async function readGoldenTasks(repoRoot: string): Promise<GoldenTask[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(goldenPath(repoRoot), "utf8"));
    if (!Array.isArray(parsed)) throw new Error("golden task store must contain an array");
    if (!parsed.every(isGoldenTask)) throw new Error("golden task store contains an invalid task");
    return parsed;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeGoldenTasks(repoRoot: string, tasks: GoldenTask[]): Promise<void> {
  await writeFileAtomic(goldenPath(repoRoot), `${JSON.stringify(tasks, null, 2)}\n`);
}

function acceptanceCommand(meta: Record<string, unknown>, body: string): string | undefined {
  for (const value of [meta.testCmd, meta.acceptance, meta.acceptCmd, meta.acceptanceCmd]) {
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const item = value.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
      if (item) return item;
    }
  }
  return extractAcceptance(body) ?? undefined;
}

function runInTemporaryEnvironment(repoRoot: string, cmd: string): Promise<{ code: number; stderr: string }> {
  return mkdtemp(join(tmpdir(), "kunpeng-golden-")).then(async (temporaryDir) => {
    try {
      return await new Promise((resolve) => {
        exec(cmd, {
          cwd: repoRoot,
          env: { ...process.env, TMPDIR: temporaryDir },
          maxBuffer: 10 * 1024 * 1024,
          shell: "/bin/bash",
          timeout: 300_000,
        }, (error, _stdout, stderr) => {
          const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
          resolve({ code, stderr });
        });
      });
    } finally {
      await rm(temporaryDir, { recursive: true, force: true });
    }
  });
}

function parseSample(args: string[]): number | undefined {
  const index = args.indexOf("--sample");
  if (index < 0) return undefined;
  const raw = args[index + 1];
  const sample = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isSafeInteger(sample) || sample < 0) {
    throw new Error("--sample 必须是非负整数");
  }
  return sample;
}

function printReport(report: GoldenReport): void {
  console.log(`[golden] ${report.passed}/${report.total} passed，${report.regressions.length} regressions`);
  for (const regression of report.regressions) {
    console.log(`\n[regression] ${regression.id}`);
    console.log(`  acceptCmd: ${regression.acceptCmd}`);
    console.log(`  stderrTail: ${regression.stderrTail || "(empty stderr)"}`);
  }
}

async function harvest(context: CliContext): Promise<void> {
  const flowId = context.rest[1];
  if (!flowId) throw new Error("用法: kunpeng eval harvest <flowId>");

  const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
  const artifact = await store.read(flowId);
  if (artifact.kind !== "spec" || artifact.status !== "verified") {
    throw new Error(`flow ${flowId} 没有 verified spec，拒绝采集`);
  }
  const task = harvestGoldenTask({
    flowId,
    requirement: artifact.body,
    acceptCmd: acceptanceCommand(artifact.meta, artifact.body),
  }, Date.now);
  if (task === null) throw new Error(`flow ${flowId} 缺少验收命令，不可重放`);

  const current = await readGoldenTasks(context.repoRoot);
  const next = [...current.filter((candidate) => candidate.id !== task.id), task]
    .sort((left, right) => left.id.localeCompare(right.id));
  await writeGoldenTasks(context.repoRoot, next);
  console.log(`[golden] 已采集 ${flowId} → ${goldenPath(context.repoRoot)}`);
}

async function run(context: CliContext): Promise<void> {
  const sample = parseSample(context.rest.slice(1));
  const allTasks = await readGoldenTasks(context.repoRoot);
  const tasks = sample === undefined ? allTasks : allTasks.slice(0, sample);
  const result = await runGoldenSuite({
    tasks,
    exec: (cmd) => runInTemporaryEnvironment(context.repoRoot, cmd),
  });
  const generatedAt = Date.now();
  const report: GoldenReport = {
    ...result,
    generatedAt,
    ...(sample === undefined ? {} : { sample }),
  };
  const path = join(evalDir(context.repoRoot), `report-${generatedAt}.json`);
  await writeFileAtomic(path, `${JSON.stringify(report, null, 2)}\n`);
  printReport(report);
  console.log(`\n[golden] report: ${path}`);
  if (report.regressions.length > 0) process.exitCode = 1;
}

async function report(context: CliContext): Promise<void> {
  const files = (await readdir(evalDir(context.repoRoot)).catch((): string[] => []))
    .filter((file) => /^report-\d+\.json$/.test(file))
    .sort();
  const latest = files.at(-1);
  if (!latest) {
    console.log("[golden] 尚无 report");
    return;
  }
  const path = join(evalDir(context.repoRoot), latest);
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isGoldenReport(parsed)) throw new Error(`report 格式无效: ${path}`);
  printReport(parsed);
  console.log(`\n[golden] report: ${path}`);
}

function isGoldenReport(value: unknown): value is GoldenReport {
  if (!isRecord(value)
    || typeof value.generatedAt !== "number"
    || typeof value.total !== "number"
    || typeof value.passed !== "number"
    || !Array.isArray(value.regressions)) return false;
  return value.regressions.every((item) => isRecord(item)
    && typeof item.id === "string"
    && typeof item.acceptCmd === "string"
    && typeof item.stderrTail === "string");
}

async function evalCommand(context: CliContext): Promise<void> {
  const action = context.rest[0];
  if (action === "harvest") return harvest(context);
  if (action === "run") return run(context);
  if (action === "report") return report(context);
  throw new CliUsageError(EVAL_USAGE);
}

registerCliCommand({ name: "eval", usage: EVAL_USAGE, run: evalCommand });
