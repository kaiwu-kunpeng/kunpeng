/**
 * 配额追踪 (quota-tracker)
 *
 * 纯内存计数器：按 `(account, model)` 维度累加调用次数。
 * 不读文件、不跑命令、不持久化、不调用 LLM——只在进程内累加与汇总（宪法 C8）。
 * 消费上游已确定的 `(account, model)` 二元组，不负责路由决策。
 */

import { dirname } from "node:path";

import { withDirLock } from "../taskboard/lock.js";
import { writeFileAtomic } from "../util/atomic-write.js";

export interface QuotaRecord {
  account: string;
  model: string;
  calls: number;
  windowStart?: number;
}

export interface QuotaState {
  schema: "kunpeng-quota/v1";
  records: QuotaRecord[];
  windowHours?: number;
}

/** 按 `(account, model)` 维度累加调用次数的内存计数器。 */
export class QuotaTracker {
  /** 键为 `(account, model)` 的组合，值为该维度当前计数。 */
  private counts = new Map<string, QuotaRecord>();
  /** 每个维度上次已 flush 到盘的调用数。 */
  private baseline = new Map<string, number>();
  /** 每个账户的窗口开始时间。 */
  private accountWindows = new Map<string, number>();
  /** 全局默认窗口（构造时给定，作为未在 accounts.json 指定 windowHours 的账号兜底）。 */
  private readonly windowHours?: number;
  /** 账号级窗口（来自 accounts.json，由 applyAccountConfig 注入）。优先于全局默认。 */
  private accountWindowHours = new Map<string, number>();

  constructor(options?: { windowHours?: number }) {
    this.windowHours = options?.windowHours;
  }

  /**
   * 注入账号级窗口配置（窗口时长是 accounts.json 的【配置】而非 quota.json 的【状态】，
   * 每次运行由 cli.ts/总控台从 accounts.json 重新喂入）。这是 P3 滑动窗真正接进生产的关键：
   * loadQuota 首次返回的 tracker 没有任何 windowHours，靠本方法把账号配置接上。
   */
  applyAccountConfig(accounts: { id: string; windowHours?: number }[]): void {
    for (const a of accounts) {
      if (a.windowHours !== undefined) this.accountWindowHours.set(a.id, a.windowHours);
    }
  }

  /** 解析某账号实际生效的窗口时长：账号级优先，否则用全局默认。 */
  private windowHoursFor(account: string): number | undefined {
    return this.accountWindowHours.get(account) ?? this.windowHours;
  }

  /** 给 `(account, model)` 这一维度的计数 +1（首次出现则初始化为 1）。 */
  record(account: string, model: string, now?: number): void {
    const key = this.keyOf(account, model);

    // 检查并重置过期窗口（按该账号实际生效的窗口时长）
    const recWindowHours = this.windowHoursFor(account);
    if (recWindowHours && now !== undefined) {
      const windowMs = recWindowHours * 3600 * 1000;
      const windowStart = this.accountWindows.get(account);

      if (windowStart !== undefined && now - windowStart >= windowMs) {
        // 窗口已过期，清除该账户的所有记录并重置窗口
        for (const [k, v] of this.counts.entries()) {
          if (v.account === account) {
            this.counts.delete(k);
          }
        }
        this.accountWindows.set(account, now);
      }
    }

    // 初始化或更新窗口开始时间
    if (!this.accountWindows.has(account) && now !== undefined) {
      this.accountWindows.set(account, now);
    }

    // 更新计数
    const existing = this.counts.get(key);
    if (existing) {
      existing.calls += 1;
    } else {
      this.counts.set(key, {
        account,
        model,
        calls: 1,
        windowStart: this.accountWindows.get(account),
      });
    }
  }

  /** 返回该账号当前窗内跨所有 model 的 calls 之和（过期窗按 0 计）。 */
  accountTotal(account: string, now: number): number {
    const wh = this.windowHoursFor(account);
    if (!wh) {
      let sum = 0;
      for (const record of this.counts.values()) {
        if (record.account === account) {
          sum += record.calls;
        }
      }
      return sum;
    }

    const windowMs = wh * 3600 * 1000;
    const windowStart = this.accountWindows.get(account);

    // 如果没有窗口开始时间，返回 0
    if (windowStart === undefined) return 0;

    // 检查窗口是否已过期
    if (now - windowStart >= windowMs) {
      return 0;
    }

    let sum = 0;
    for (const record of this.counts.values()) {
      if (record.account === account) {
        sum += record.calls;
      }
    }

    return sum;
  }

  /** 返回该账号最早窗距重置的剩余毫秒（无窗返回 undefined）。 */
  windowResetMs(account: string, now: number): number | undefined {
    const wh = this.windowHoursFor(account);
    if (!wh) return undefined;

    const windowStart = this.accountWindows.get(account);
    if (windowStart === undefined) return undefined;

    const windowMs = wh * 3600 * 1000;
    const resetTime = windowStart + windowMs;
    const remaining = Math.max(0, resetTime - now);
    return remaining;
  }

  /** 返回每个出现过的 `(account, model)` 维度的当前 `calls`，每个唯一二元组一条记录。 */
  usage(): QuotaRecord[] {
    return [...this.counts.values()].map((r) => ({ ...r }));
  }

  /** 导出相对上次已 flush 基线的计数增量。 */
  exportDeltas(): { account: string; model: string; delta: number; windowStart?: number }[] {
    const deltas: { account: string; model: string; delta: number; windowStart?: number }[] = [];
    for (const [key, record] of this.counts.entries()) {
      const delta = record.calls - (this.baseline.get(key) ?? 0);
      if (delta !== 0) {
        deltas.push({
          account: record.account,
          model: record.model,
          delta,
          windowStart: record.windowStart,
        });
      }
    }
    return deltas;
  }

  /** 将已 flush 的增量推进到内存基线。 */
  commitDeltas(deltas: { account: string; model: string; delta: number }[]): void {
    for (const { account, model, delta } of deltas) {
      const key = this.keyOf(account, model);
      this.baseline.set(key, (this.baseline.get(key) ?? 0) + delta);
    }
  }

  /** 将调用增量合并到当前内存计数。 */
  addCalls(account: string, model: string, delta: number, windowStart?: number): void {
    const key = this.keyOf(account, model);
    const existing = this.counts.get(key);
    if (existing) {
      existing.calls += delta;
    } else {
      this.counts.set(key, { account, model, calls: delta, windowStart });
    }
    if (windowStart !== undefined && !this.accountWindows.has(account)) {
      this.accountWindows.set(account, windowStart);
    }
  }

  /** 返回所有维度计数之和，即总调用数。 */
  total(): number {
    let sum = 0;
    for (const r of this.counts.values()) sum += r.calls;
    return sum;
  }

  /** 序列化为 JSON 格式。 */
  toJSON(): QuotaState {
    return {
      schema: "kunpeng-quota/v1",
      records: this.usage(),
      ...(this.windowHours && { windowHours: this.windowHours }),
    };
  }

  /** 从 JSON 格式重构 tracker。 */
  static fromJSON(state: QuotaState): QuotaTracker {
    const tracker = new QuotaTracker({ windowHours: state.windowHours });
    for (const record of state.records) {
      const restored = { ...record };
      const key = tracker.keyOf(restored.account, restored.model);
      tracker.counts.set(key, restored);
      tracker.baseline.set(key, restored.calls);
      // 从记录恢复 accountWindows
      if (restored.windowStart !== undefined && !tracker.accountWindows.has(restored.account)) {
        tracker.accountWindows.set(restored.account, restored.windowStart);
      }
    }
    return tracker;
  }

  /** JSON tuple key avoids collisions when account/model contain whitespace or separators. */
  private keyOf(account: string, model: string): string {
    return JSON.stringify([account, model]);
  }
}

/** 从文件加载 quota 状态。文件缺失时返回空 tracker。 */
export async function loadQuota(path: string): Promise<QuotaTracker> {
  try {
    const { readFile } = await import("fs/promises");
    const content = await readFile(path, "utf-8");
    const state = JSON.parse(content) as QuotaState;
    return QuotaTracker.fromJSON(state);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return new QuotaTracker();
    }
    throw e;
  }
}

/** 在目录锁内把 tracker 增量合并到盘上真值并原子写回。 */
export async function saveQuota(filePath: string, tracker: QuotaTracker): Promise<void> {
  await withDirLock(dirname(filePath), async () => {
    const deltas = tracker.exportDeltas();
    tracker.commitDeltas(deltas);
    const disk = await loadQuota(filePath);
    for (const delta of deltas) {
      disk.addCalls(delta.account, delta.model, delta.delta, delta.windowStart);
    }
    const state = disk.toJSON();
    const trackerWindowHours = tracker.toJSON().windowHours;
    if (state.windowHours === undefined && trackerWindowHours !== undefined) {
      state.windowHours = trackerWindowHours;
    }
    await writeFileAtomic(filePath, JSON.stringify(state, null, 2));
  });
}
