import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eventLoopLag } from "./event-loop-monitor.js";
import { errorMessage } from "../util/errors.js";

export interface HealthzCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface HealthzReport {
  ok: boolean;
  checks: HealthzCheck[];
}

async function checkStateDirWritable(stateDir: string): Promise<HealthzCheck> {
  const probePath = join(stateDir, `.healthz-probe-${randomUUID()}`);
  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(probePath, "healthz");
    await unlink(probePath);
    return { name: "state-dir-writable", ok: true };
  } catch (error) {
    return { name: "state-dir-writable", ok: false, detail: errorMessage(error) };
  }
}

function checkEventLoop(): HealthzCheck {
  try {
    const { p99Ms } = eventLoopLag();
    if (!Number.isFinite(p99Ms)) return { name: "event-loop", ok: true };
    if (p99Ms > 1000) {
      return { name: "event-loop", ok: false, detail: `p99 ${p99Ms}ms exceeds 1000ms` };
    }
    return { name: "event-loop", ok: true };
  } catch (error) {
    return { name: "event-loop", ok: true, detail: `metric unavailable: ${errorMessage(error)}` };
  }
}

export async function collectHealthz(deps: { stateDir: string }): Promise<HealthzReport> {
  const checks = [await checkStateDirWritable(deps.stateDir), checkEventLoop()];
  return { ok: checks.every((check) => check.ok), checks };
}
