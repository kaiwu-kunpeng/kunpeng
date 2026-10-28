import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Task } from "./store.js";
import { hasErrnoCode } from "../util/errors.js";

export type GateResult = {
  allow: boolean;
  feedback?: string;
  gateError?: boolean;
};

interface GateExecution {
  code: number | null;
  stderr: string;
}

export type CompletedGateSpawn = (file: string, input: string) => Promise<GateExecution>;

const GATE_TIMEOUT_MS = 30_000;

function gateFailure(exit: number | null | "error"): GateResult {
  return {
    allow: true,
    gateError: true,
    feedback: `门脚本故障(exit ${String(exit)}),放行但需关注`,
  };
}

const spawnGate: CompletedGateSpawn = (file, input) => new Promise((resolve, reject) => {
  const child = spawn(file, [], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  let settled = false;
  const timeout = setTimeout(() => child.kill(), GATE_TIMEOUT_MS);
  timeout.unref();

  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(error);
  };

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.once("error", fail);
  child.stdin.once("error", fail);
  child.once("close", (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve({ code, stderr });
  });
  child.stdin.end(input);
});

async function gateFiles(gatesDir: string, requireExecutable: boolean): Promise<string[] | null> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(gatesDir, { withFileTypes: true });
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) return null;
    throw error;
  }
  const files = await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() && !entry.isSymbolicLink()) return null;
    const path = join(gatesDir, entry.name);
    const metadata = await stat(path);
    return metadata.isFile() && (!requireExecutable || (metadata.mode & 0o111) !== 0) ? path : null;
  }));
  return files.filter((file): file is string => file !== null).sort();
}

export async function runCompletedGates(
  gatesDir: string,
  task: Task,
  spawnImpl: CompletedGateSpawn = spawnGate,
): Promise<GateResult> {
  let files: string[] | null;
  try {
    // 注入执行器时由替身负责“执行”，无需依赖宿主文件的执行位；真实执行仍严格只跑可执行文件。
    files = await gateFiles(gatesDir, spawnImpl === spawnGate);
  } catch {
    return gateFailure("error");
  }
  if (files === null) return { allow: true };

  const input = JSON.stringify(task);
  for (const file of files) {
    let execution: GateExecution;
    try {
      execution = await spawnImpl(file, input);
    } catch {
      return gateFailure("error");
    }
    if (execution.code === 0) continue;
    if (execution.code === 2) {
      return { allow: false, feedback: execution.stderr.slice(-500) };
    }
    return gateFailure(execution.code);
  }
  return { allow: true };
}
