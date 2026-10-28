import { findingsToTasks } from "./finding-to-task.js";
import type { Finding, Severity } from "../loop/guardian.js";
import type { ReinjectStore } from "./reinject-store.js";

export interface ReinjectReport { scanned: number; added: string[]; skipped: string[]; pending: number; }

/** 把守护发现转任务、入队去重、返回报告。findings 由调用方提供(cli 跑真扫描/测试给 fixture)。 */
export async function runReinjectScan(deps: {
  findings: Finding[]; store: ReinjectStore; now: number; minSeverity?: Severity;
}): Promise<ReinjectReport> {
  const tasks = findingsToTasks(deps.findings, { minSeverity: deps.minSeverity });
  const { added, skipped } = await deps.store.enqueue(tasks, deps.now);
  const pending = (await deps.store.pending()).length;
  return { scanned: deps.findings.length, added, skipped, pending };
}
