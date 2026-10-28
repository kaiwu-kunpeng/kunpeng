import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegressionStore } from "../../src/evolution/regression-store.js";

const POISONED = "cd orchestrator && cat > test/x.test.ts <<'TESTEOF' import x from 'y'";

function seed(dir: string, poisoned: number, good: number): void {
  let n = 0;
  const put = (acceptanceCmd: string) => {
    n += 1;
    writeFileSync(join(dir, `case-${n}.json`), JSON.stringify({
      id: `case-${n}`, requirement: "r", acceptanceCmd, sourceFlow: `flow-${n}`, set: "optimization", createdAt: 1,
    }));
  };
  for (let i = 0; i < poisoned; i += 1) put(POISONED);
  for (let i = 0; i < good; i += 1) put("cd orchestrator && npx vitest run test/a.test.ts");
}

let dirs: string[] = [];
const mk = (): string => { const d = mkdtempSync(join(tmpdir(), "kp-regq-")); dirs.push(d); return d; };

beforeEach(() => { dirs = []; });
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe("回归库隔离告警汇总成一行（作者锁定）", () => {
  test("3 条被隔离 + 1 条正常：只打一行，含总数与目录；返回值不变", async () => {
    const dir = mk();
    seed(dir, 3, 1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tasks = await new RegressionStore(dir).list();
    expect(tasks).toHaveLength(1);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[regression-store]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("隔离 3 条");
    expect(lines[0]).toContain(dir);
    expect(lines[0]).not.toContain("隔离验收命令被截断的用例:");
    expect(await new RegressionStore(dir).listQuarantined()).toHaveLength(3);
  });

  test("同进程同目录再次 list（新实例也一样）不再打印；换目录再打一行", async () => {
    const a = mk();
    const b = mk();
    seed(a, 2, 0);
    seed(b, 1, 0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await new RegressionStore(a).list();
    await new RegressionStore(a).list();
    await new RegressionStore(a).list("holdout");
    await new RegressionStore(b).list();
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[regression-store]"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("隔离 2 条");
    expect(lines[1]).toContain("隔离 1 条");
  });

  test("没有被隔离的用例 → 不打印", async () => {
    const dir = mk();
    seed(dir, 0, 2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await new RegressionStore(dir).list()).toHaveLength(2);
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith("[regression-store]"))).toEqual([]);
  });
});