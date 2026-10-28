import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { abandonFlow } from "../../src/runtime/flow-abandon.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-abandon-cas-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stateDir = () => join(dir, "state");

test("abandonFlow 与并发 addTokens 都落盘：version +2、带 schemaVersion", async () => {
  const t = new FlowTracker(stateDir(), () => 1_700_000_000_000);
  await t.start("a1", "req");
  await t.block("a1", "卡在 verify");
  const before = (await t.read("a1"))!.version!;

  const other = new FlowTracker(stateDir());
  const [res] = await Promise.all([abandonFlow(stateDir(), "a1", () => 1_700_000_001_000), other.addTokens("a1", 3)]);
  expect(res).toEqual({ ok: true });

  const flow = (await t.read("a1"))!;
  expect(flow.status).toBe("rolled-back");
  expect(flow.stage).toBe("done");
  expect(flow.tokensUsed).toBe(3);
  expect(flow.version).toBe(before + 2);
  expect(flow.history.at(-1)?.stage).toBe("abandoned");
  expect(flow.failureReason).toBe("[abandoned] 人工放弃该流；放弃前卡点：卡在 verify");
  const disk = JSON.parse(readFileSync(join(stateDir(), "a1.json"), "utf8")) as Record<string, unknown>;
  expect(typeof disk.schemaVersion).toBe("number");
});

test("未知流仍返回 ok:false", async () => {
  expect(await abandonFlow(stateDir(), "missing")).toEqual({ ok: false, error: "未知流 missing" });
});

test("flow-abandon.ts 不再自己写文件", () => {
  const src = readFileSync(new URL("../../src/runtime/flow-abandon.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/writeFileAtomic/);
  expect(src).toMatch(/\.mutate\(/);
});