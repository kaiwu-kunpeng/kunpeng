import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  MAX_ROUNDS_PER_KEY, STALLED_THRESHOLD, STARVED_THRESHOLD,
  alertLine, detectAlerts, loadLedger, loopYieldPath, recordRound, saveLedger,
  type LoopRound, type LoopYieldLedger,
} from "../../src/metrics/loop-yield.js";

const round = (over: Partial<LoopRound> = {}): LoopRound => ({
  loop: "scout", project: "kunpeng", input: 1, yield: 0, at: 1_000, ...over,
});

/** 造一串同 key 的连续轮次，at 递增。 */
function series(specs: Array<Pick<LoopRound, "input" | "yield">>, over: Partial<LoopRound> = {}): LoopYieldLedger {
  let ledger: LoopYieldLedger = { rounds: [] };
  specs.forEach((s, i) => {
    ledger = recordRound(ledger, round({ ...over, input: s.input, yield: s.yield, at: 1_000 + i }));
  });
  return ledger;
}

describe("recordRound", () => {
  test("是纯函数:不改传入的 ledger", () => {
    const before: LoopYieldLedger = { rounds: [round()] };
    const snapshot = JSON.stringify(before);
    const after = recordRound(before, round({ at: 2_000 }));
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.rounds).toHaveLength(2);
    expect(after).not.toBe(before);
  });

  test("按加入顺序追加到末尾", () => {
    const l = series([{ input: 1, yield: 1 }, { input: 2, yield: 2 }, { input: 3, yield: 3 }]);
    expect(l.rounds.map((r) => r.input)).toEqual([1, 2, 3]);
  });

  test("每 key 封顶只保留最近 max 条,且不影响别的 key", () => {
    let l: LoopYieldLedger = { rounds: [] };
    l = recordRound(l, round({ loop: "patrol", project: "p", input: 9, yield: 9, at: 1 }));
    for (let i = 0; i < 5; i += 1) {
      l = recordRound(l, round({ loop: "scout", project: "kunpeng", input: i, yield: 0, at: 100 + i }), 3);
    }
    const scout = l.rounds.filter((r) => r.loop === "scout");
    const patrol = l.rounds.filter((r) => r.loop === "patrol");
    expect(scout).toHaveLength(3);
    expect(scout.map((r) => r.input)).toEqual([2, 3, 4]);
    expect(patrol).toHaveLength(1);
    expect(patrol[0].input).toBe(9);
  });

  test("缺省 max 就是导出的常量", () => {
    expect(MAX_ROUNDS_PER_KEY).toBeGreaterThan(0);
    let l: LoopYieldLedger = { rounds: [] };
    for (let i = 0; i < MAX_ROUNDS_PER_KEY + 4; i += 1) {
      l = recordRound(l, round({ at: i }));
    }
    expect(l.rounds).toHaveLength(MAX_ROUNDS_PER_KEY);
  });
});

describe("detectAlerts · 空转(stalled)", () => {
  test(`恰好第 ${STALLED_THRESHOLD} 轮触发`, () => {
    const specs = Array.from({ length: STALLED_THRESHOLD }, () => ({ input: 1, yield: 0 }));
    const alerts = detectAlerts(series(specs));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("stalled");
    expect(alerts[0].streak).toBe(STALLED_THRESHOLD);
    expect(alerts[0].loop).toBe("scout");
    expect(alerts[0].project).toBe("kunpeng");
  });

  test(`第 ${STALLED_THRESHOLD - 1} 轮不触发(边界)`, () => {
    const specs = Array.from({ length: STALLED_THRESHOLD - 1 }, () => ({ input: 1, yield: 0 }));
    expect(detectAlerts(series(specs))).toEqual([]);
  });

  test("最近一轮有产出 → 不告警,哪怕更早有很长零产出段", () => {
    const specs = [
      ...Array.from({ length: STALLED_THRESHOLD + 5 }, () => ({ input: 1, yield: 0 })),
      { input: 1, yield: 1 },
    ];
    expect(detectAlerts(series(specs))).toEqual([]);
  });

  test("input===0 的轮不算进 stalled 段", () => {
    const specs = [
      { input: 1, yield: 0 }, { input: 0, yield: 0 }, { input: 1, yield: 0 }, { input: 1, yield: 0 },
    ];
    const alerts = detectAlerts(series(specs), { stalled: 3, starved: 99 });
    expect(alerts).toEqual([]);
  });

  test("since 取连续段最早那轮的 at", () => {
    const specs = [
      { input: 1, yield: 1 },
      ...Array.from({ length: STALLED_THRESHOLD }, () => ({ input: 1, yield: 0 })),
    ];
    const alerts = detectAlerts(series(specs));
    expect(alerts[0].since).toBe(1_001);
  });
});

describe("detectAlerts · 饿死(starved)", () => {
  test(`恰好第 ${STARVED_THRESHOLD} 轮触发`, () => {
    const specs = Array.from({ length: STARVED_THRESHOLD }, () => ({ input: 0, yield: 0 }));
    const alerts = detectAlerts(series(specs, { loop: "flywheel" }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("starved");
    expect(alerts[0].streak).toBe(STARVED_THRESHOLD);
  });

  test(`第 ${STARVED_THRESHOLD - 1} 轮不触发(边界)`, () => {
    const specs = Array.from({ length: STARVED_THRESHOLD - 1 }, () => ({ input: 0, yield: 0 }));
    expect(detectAlerts(series(specs, { loop: "flywheel" }))).toEqual([]);
  });

  test("autopilot 长期无门可合 → 是饿死,不是空转(不许误报机件坏)", () => {
    const specs = Array.from({ length: STARVED_THRESHOLD + 3 }, () => ({ input: 0, yield: 0 }));
    const alerts = detectAlerts(series(specs, { loop: "autopilot", project: "kunpeng" }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("starved");
  });
});

describe("detectAlerts · 多 key", () => {
  test("一个 key 最多一条告警,多 key 各自独立且按字典序返回", () => {
    let l: LoopYieldLedger = { rounds: [] };
    for (let i = 0; i < STALLED_THRESHOLD; i += 1) {
      l = recordRound(l, round({ loop: "scout", project: "b", input: 1, yield: 0, at: 10 + i }));
      l = recordRound(l, round({ loop: "scout", project: "a", input: 1, yield: 0, at: 20 + i }));
      l = recordRound(l, round({ loop: "patrol", project: "z", input: 5, yield: 5, at: 30 + i }));
    }
    const alerts = detectAlerts(l);
    expect(alerts.map((a) => `${a.loop}/${a.project}`)).toEqual(["scout/a", "scout/b"]);
  });

  test("空台账 → 无告警", () => {
    expect(detectAlerts({ rounds: [] })).toEqual([]);
  });
});

describe("alertLine", () => {
  test("以 [告警] 开头,带 loop/project/streak 与中文种类字样", () => {
    const stalled = alertLine({ loop: "scout", project: "kunpeng", kind: "stalled", streak: 12, since: 1 });
    expect(stalled.startsWith("[告警]")).toBe(true);
    expect(stalled).toContain("scout");
    expect(stalled).toContain("kunpeng");
    expect(stalled).toContain("12");
    expect(stalled).toContain("空转");

    const starved = alertLine({ loop: "flywheel", project: "kunpeng", kind: "starved", streak: 10, since: 1 });
    expect(starved.startsWith("[告警]")).toBe(true);
    expect(starved).toContain("饿死");
  });
});

describe("台账落盘", () => {
  test("路径在 .kunpeng/loop-yield.json 下", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ly-"));
    expect(loopYieldPath(dir)).toBe(join(dir, ".kunpeng", "loop-yield.json"));
  });

  test("save → load 往返一致,目录不存在也能建", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ly-"));
    const ledger = series([{ input: 1, yield: 0 }, { input: 2, yield: 2 }]);
    await saveLedger(dir, ledger);
    expect(JSON.parse(await readFile(loopYieldPath(dir), "utf8")).rounds).toHaveLength(2);
    expect(await loadLedger(dir)).toEqual(ledger);
  });

  test("文件不存在 → 空台账,不抛", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ly-"));
    await expect(loadLedger(dir)).resolves.toEqual({ rounds: [] });
  });

  test("文件损坏 / 形状不对 → 空台账,不抛", async () => {
    for (const bad of ["{ not json", "null", "[]", '{"rounds":"nope"}']) {
      const dir = await mkdtemp(join(tmpdir(), "ly-"));
      await mkdir(join(dir, ".kunpeng"), { recursive: true });
      await writeFile(loopYieldPath(dir), bad, "utf8");
      await expect(loadLedger(dir)).resolves.toEqual({ rounds: [] });
    }
  });
});

describe("接线到位", () => {
  test("四个循环都调了 recordAndWarn", async () => {
    const files = [
      "../../src/cli-commands/loop-core.ts",
      "../../src/cli-commands/flywheel-eval.ts",
      "../../src/cli-commands/board-serve.ts",
    ];
    for (const f of files) {
      const src = await readFile(new URL(f, import.meta.url), "utf8");
      expect(src, `${f} 应调 recordAndWarn`).toContain("recordAndWarn");
    }
    const core = await readFile(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");
    expect(core).toContain('loop: "autopilot"');
    expect(core).toContain('loop: "patrol"');
    const fly = await readFile(new URL("../../src/cli-commands/flywheel-eval.ts", import.meta.url), "utf8");
    expect(fly).toContain('loop: "flywheel"');
    const scout = await readFile(new URL("../../src/cli-commands/board-serve.ts", import.meta.url), "utf8");
    expect(scout).toContain('loop: "scout"');
  });

  test("recordAndWarn 不抛:IO 失败也返回 null", async () => {
    const { recordAndWarn } = await import("../../src/metrics/loop-yield-record.js");
    const impossible = join("/dev", "null", "nope", "nowhere");
    await expect(
      recordAndWarn(impossible, { loop: "scout", project: "x", input: 1, yield: 0 }),
    ).resolves.toBeNull();
  });

  test("cli.ts 注册了 loop-yield 命令", async () => {
    const src = await readFile(new URL("../../src/cli.ts", import.meta.url), "utf8");
    expect(src).toContain("loop-yield-cmd.js");
    expect(src).toContain("loop-yield");
  });
});