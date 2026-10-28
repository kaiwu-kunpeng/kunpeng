import * as fs from "node:fs/promises";
import { join } from "node:path";

import { readableSubject } from "./summary.js";
import type { Wave } from "./types.js";

export type LearningKind = "weak" | "blocked" | "win" | "note";

export interface Learning {
  at: number;
  waveSeq: number;
  lever: string;
  subject: string;
  kind: LearningKind;
  lesson: string;
}

export function deriveLearning(wave: Wave): Learning | null {
  const subject = readableSubject(wave);
  const base = { at: wave.at, waveSeq: wave.seq, lever: wave.lever, subject };
  if (wave.instrumentBroken === true) {
    return { ...base, kind: "blocked", lesson: `${subject}：仪器故障（全部题目无法解析），本波未计入指标，先修仪器再看趋势` };
  }
  const detail = wave.detail ?? "";

  if (wave.metricDelta === 0) {
    if (/0 priced suppliers/i.test(detail)) {
      return {
        ...base,
        kind: "weak",
        lesson: `${subject}：候选供应商全无带价（疑弱品类或反爬），下次降低优先级或先确认换区生效`,
      };
    }
    if (!wave.verified) {
      return { ...base, kind: "blocked", lesson: `${subject}：未验证且零增量，排查抓取/核验链路` };
    }
    return { ...base, kind: "blocked", lesson: `${subject}：零增量，疑数据源薄或被过滤` };
  }

  if (wave.metricDelta >= 30) {
    return { ...base, kind: "win", lesson: `${subject}：高产 +${wave.metricDelta}，同型大件值得优先扩` };
  }

  if (wave.gotchas && wave.gotchas.length > 0) {
    return { ...base, kind: "note", lesson: `${subject}：${wave.gotchas[0]}` };
  }

  return null;
}

type FileSystem = Pick<typeof fs, "mkdir" | "readFile" | "writeFile" | "rename" | "unlink">;

export class LoopLearningStore {
  constructor(private dir: string, private io: FileSystem = fs) {}

  private path(id: string): string {
    return join(this.dir, `${id}.learnings.json`);
  }

  async recent(id: string, n = 20): Promise<Learning[]> {
    try {
      const raw = await this.io.readFile(this.path(id), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as Learning[]).slice(-n).reverse() : [];
    } catch {
      return [];
    }
  }

  async append(id: string, learning: Learning): Promise<void> {
    let arr: Learning[] = [];
    try {
      const raw = await this.io.readFile(this.path(id), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) arr = parsed as Learning[];
    } catch {
      // Missing or invalid existing store starts a fresh append-only file.
    }

    arr.push(learning);
    await this.io.mkdir(this.dir, { recursive: true });
    const path = this.path(id);
    const tmp = `${path}.${process.pid}.${arr.length}.tmp`;
    try {
      await this.io.writeFile(tmp, `${JSON.stringify(arr, null, 2)}\n`, "utf8");
      await this.io.rename(tmp, path);
    } catch (e) {
      await this.io.unlink(tmp).catch(() => undefined);
      throw e;
    }
  }
}
