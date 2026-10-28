import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact } from "../../src/artifacts/types.js";
import {
  assignSet,
  poisonedAcceptanceReason,
  RegressionStore,
  tasksFromVerifiedSpecs,
  type RegressionTask,
} from "../../src/evolution/regression-store.js";

// 真实残骸：回归库 h866805080.json 的验收命令只剩 heredoc 开头，跑一次就把目标文件截成 0 字节。
const TRUNCATED = "cd orchestrator && mkdir -p test/server && cat > test/server/architecture-graph.test.ts <<'TESTEOF'";
const COMPLETE = [
  "cd orchestrator && cat > /tmp/x.test.ts <<'TESTEOF'",
  "import { test } from \"vitest\";",
  "test(\"x\", () => {});",
  "TESTEOF",
  "npx vitest run /tmp/x.test.ts",
].join("\n");

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-regression-poisoned-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function task(id: string, acceptanceCmd: string): RegressionTask {
  return { id, requirement: `requirement ${id}`, acceptanceCmd, sourceFlow: id, set: "holdout", createdAt: 12345 };
}
function writeTask(t: RegressionTask): void {
  writeFileSync(join(dir, `${t.id}.json`), `${JSON.stringify(t, null, 2)}\n`, "utf8");
}

test("识别被截成单行的 heredoc；完整 heredoc 与普通命令不算", () => {
  expect(poisonedAcceptanceReason(TRUNCATED)).toMatch(/TESTEOF/);
  expect(poisonedAcceptanceReason("cat <<-EOF\n\thello")).toMatch(/EOF/);
  expect(poisonedAcceptanceReason("cat <<\"DOC\" > a.txt")).toMatch(/DOC/);
  expect(poisonedAcceptanceReason(COMPLETE)).toBeUndefined();
  expect(poisonedAcceptanceReason("cat <<EOF\nhello\nEOF")).toBeUndefined();
  expect(poisonedAcceptanceReason("cd orchestrator && npx vitest run a.test.ts")).toBeUndefined();
});

test("list 隔离被截断的用例、listQuarantined 报出来，rotate 仍改写全部文件", async () => {
  const store = new RegressionStore(dir);
  writeTask(task("clean-a", "npx vitest run a.test.ts"));
  writeTask(task("poisoned-b", TRUNCATED));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect((await store.list("holdout")).map((t) => t.id)).toEqual(["clean-a"]);
    expect((await store.list()).map((t) => t.id)).toEqual(["clean-a"]);
    const quarantined = await store.listQuarantined();
    expect(quarantined.map((q) => q.task.id)).toEqual(["poisoned-b"]);
    expect(quarantined[0]!.reason).toMatch(/TESTEOF/);

    const rotated = await store.rotate(1);
    expect(rotated.holdout + rotated.optimization).toBe(2);
    const raw = JSON.parse(readFileSync(join(dir, "poisoned-b.json"), "utf8")) as RegressionTask;
    expect(raw.set).toBe(assignSet("poisoned-b", 1));
    expect(raw.acceptanceCmd).toBe(TRUNCATED);
  } finally {
    warn.mockRestore();
  }
});

test("沉淀时跳过验收命令被截断的 verified spec", () => {
  const specs: Artifact[] = [
    { kind: "spec", id: "flow-poisoned", status: "verified", body: "x", meta: { testCmd: TRUNCATED } },
    { kind: "spec", id: "flow-clean", status: "verified", body: "y", meta: { testCmd: "npx vitest run y.test.ts" } },
  ];
  expect(tasksFromVerifiedSpecs(specs, 1).map((t) => t.id)).toEqual(["flow-clean"]);
});