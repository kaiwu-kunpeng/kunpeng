import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Artifact } from "../artifacts/types.js";

export type RegressionSet = "optimization" | "holdout";

const warnedQuarantinedDirs = new Set<string>();

export function poisonedAcceptanceReason(cmd: string): string | undefined {
  // 历史目录可能含其它可解析 JSON，不能因缺失命令让整批读取失败。
  if (typeof cmd !== "string") return undefined;
  const openers = /(?<!<)<<-?[ \t]*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/g;
  for (const match of cmd.matchAll(openers)) {
    const word = match[1] ?? match[2] ?? match[3];
    const nextLine = cmd.indexOf("\n", match.index + match[0].length);
    if (nextLine === -1 || !new RegExp(`^\\s*${word}\\s*$`, "m").test(cmd.slice(nextLine + 1))) {
      return `heredoc 未闭合：${word}（验收命令被截成单行）`;
    }
  }
  return undefined;
}

export interface RegressionTask {
  id: string;
  requirement: string;
  acceptanceCmd: string;
  sourceFlow: string;
  set: RegressionSet;
  createdAt: number;
  baseCommit?: string;
}

function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function assignSet(sourceFlow: string, epoch = 0): RegressionSet {
  const hashInput = epoch === 0 ? sourceFlow : `${sourceFlow}:${epoch}`;
  return stableHash(hashInput) % 5 === 0 ? "holdout" : "optimization";
}

export function epochForTime(now: number, intervalMs = 30 * 86400000): number {
  return Math.floor(now / intervalMs);
}

function usableString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

function acceptanceCommand(value: unknown): string | undefined {
  const direct = usableString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return undefined;
  return value.find((item) => usableString(item)) as string | undefined;
}

export function tasksFromVerifiedSpecs(specs: Artifact[], now: number): RegressionTask[] {
  return specs.flatMap((spec) => {
    if (spec.kind !== "spec" || spec.status !== "verified") return [];

    const sourceFlow = spec.id;
    const acceptanceCmd = acceptanceCommand(spec.meta.testCmd ?? spec.meta.acceptance);
    if (!acceptanceCmd || poisonedAcceptanceReason(acceptanceCmd)) return [];
    const baseCommit = usableString(spec.meta.baseCommit) ?? usableString(spec.meta.base);

    return [{
      id: sourceFlow,
      requirement: spec.body,
      acceptanceCmd,
      sourceFlow,
      set: assignSet(sourceFlow),
      createdAt: now,
      ...(baseCommit ? { baseCommit } : {}),
    }];
  });
}

export function holdoutRerunBase(task: RegressionTask, fallback = "main"): string {
  return usableString(task.baseCommit) ?? fallback;
}

export class RegressionStore {
  constructor(private dir: string) {}

  private epochPath(): string {
    return join(this.dir, ".epoch");
  }

  private path(id: string): string {
    const encoded = encodeURIComponent(id);
    // 文件名上限 255 字节；中文 flow id 经 encodeURIComponent 每字膨胀为 9 字节（%XX%XX%XX），易超限 → ENAMETOOLONG 崩溃。
    // 超限回退到稳定哈希名（确定性、同 id 恒同名，保 has/sediment/list 一致）；短名保持原编码不动，不孤立已写文件。
    const name = encoded.length <= 200 ? encoded : `h${stableHash(id)}`;
    return join(this.dir, `${name}.json`);
  }

  async has(id: string): Promise<boolean> {
    try {
      await access(this.path(id));
      return true;
    } catch {
      return false;
    }
  }

  async sediment(task: RegressionTask): Promise<boolean> {
    await mkdir(this.dir, { recursive: true });
    const epoch = await this.currentEpoch();
    const set = assignSet(task.sourceFlow, epoch);
    try {
      await writeFile(this.path(task.id), `${JSON.stringify({ ...task, set }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  async list(set?: RegressionSet): Promise<RegressionTask[]> {
    const entries = await this.readTasks();
    const quarantinedFiles: string[] = [];
    const tasks = entries.flatMap(({ file, task }) => {
      const reason = poisonedAcceptanceReason(task.acceptanceCmd);
      if (reason) {
        quarantinedFiles.push(file);
        return [];
      }
      return !set || task.set === set ? [task] : [];
    });
    const dir = resolve(this.dir);
    if (quarantinedFiles.length > 0 && !warnedQuarantinedDirs.has(dir)) {
      warnedQuarantinedDirs.add(dir);
      console.warn(`[regression-store] 隔离 ${quarantinedFiles.length} 条验收被截断的用例（${dir}；首条 ${quarantinedFiles[0]}）`);
    }
    return tasks;
  }

  async listQuarantined(): Promise<Array<{ task: RegressionTask; reason: string }>> {
    const entries = await this.readTasks();
    return entries.flatMap(({ task }) => {
      const reason = poisonedAcceptanceReason(task.acceptanceCmd);
      return reason ? [{ task, reason }] : [];
    });
  }

  private async readTasks(): Promise<Array<{ file: string; task: RegressionTask }>> {
    const files = (await readdir(this.dir).catch(() => []))
      .filter((file) => file.endsWith(".json"))
      .sort();
    const parsed = await Promise.all(files.map(async (file) => {
      // 单个损坏/外来 .json（撕裂写、或 Batch3 eval-runner 写入同目录的别的文件）不得拖垮整批：跳过 + 告警。
      try {
        const task = JSON.parse(await readFile(join(this.dir, file), "utf8")) as RegressionTask;
        return task === null ? null : { file, task };
      } catch {
        console.warn(`[regression-store] 跳过无法解析的文件: ${file}`);
        return null;
      }
    }));
    return parsed.filter((entry): entry is { file: string; task: RegressionTask } => entry !== null);
  }

  async currentEpoch(): Promise<number> {
    try {
      const value = Number((await readFile(this.epochPath(), "utf8")).trim());
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  private async setEpoch(e: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.epochPath(), `${e}\n`, { encoding: "utf8" });
  }

  async rotate(newEpoch: number): Promise<{ epoch: number; holdout: number; optimization: number }> {
    const entries = await this.readTasks();
    let holdout = 0;
    let optimization = 0;
    await mkdir(this.dir, { recursive: true });

    for (const { task } of entries) {
      const set = assignSet(task.sourceFlow, newEpoch);
      if (set === "holdout") holdout += 1;
      else optimization += 1;
      await writeFile(this.path(task.id), `${JSON.stringify({ ...task, set }, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    }

    await this.setEpoch(newEpoch);
    return { epoch: newEpoch, holdout, optimization };
  }
}
