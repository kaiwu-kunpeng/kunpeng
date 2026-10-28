import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { reconcileSupersededGhosts } from "../../src/runtime/reconcile.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-reconcile-cas-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stateDir = () => join(dir, "state");

class InterposingTracker extends FlowTracker {
  constructor(d: string, private readonly afterList: () => Promise<void>) {
    super(d);
  }
  override async list() {
    const flows = await super.list();
    await this.afterList();
    return flows;
  }
}

test("退役幽灵走 CAS：list 之后别人写入的 token 不丢，version 恰好 +2", async () => {
  const t = new FlowTracker(stateDir(), () => 1_700_000_000_000);
  await t.start("ghost", "requirement for ghost");
  await t.enter("ghost", "implement", true);
  await t.markCrashed("ghost");
  const before = (await t.read("ghost"))!.version!;

  const other = new FlowTracker(stateDir());
  const interposer = new InterposingTracker(stateDir(), async () => {
    await other.addTokens("ghost", 42);
  });

  const result = await reconcileSupersededGhosts(interposer, dir, { hasBranch: async () => false });
  expect(result.retired).toEqual(["ghost"]);

  const flow = (await t.read("ghost"))!;
  expect(flow.status).toBe("rolled-back");
  expect(flow.stage).toBe("done");
  expect(flow.blocker).toBeUndefined();
  expect(flow.history.map((h) => h.stage)).toEqual(["spec", "implement", "crashed", "retired-superseded"]);
  expect(flow.tokensUsed).toBe(42);
  expect(flow.version).toBe(before + 2);
  expect(flow.failureReason ?? "").toMatch(/^\[retired-superseded\]/);
});

test("list 之后流已不是 crashed：不退役、不写盘", async () => {
  const t = new FlowTracker(stateDir(), () => 1_700_000_000_000);
  await t.start("revived", "requirement for revived");
  await t.enter("revived", "implement", true);
  await t.markCrashed("revived");

  const other = new FlowTracker(stateDir());
  const interposer = new InterposingTracker(stateDir(), async () => {
    await other.startOrResume("revived", "requirement for revived");
  });
  const versionAfterResume = async () => (await t.read("revived"))!.version;

  const result = await reconcileSupersededGhosts(interposer, dir, { hasBranch: async () => false });
  expect(result.retired).toEqual([]);
  const flow = (await t.read("revived"))!;
  expect(flow.status).toBe("running");
  expect(flow.history.some((h) => h.stage === "retired-superseded")).toBe(false);
  expect(await versionAfterResume()).toBe(flow.version);
});

test("reconcile.ts 不再用方括号索引直写私有 save", () => {
  const src = readFileSync(new URL("../../src/runtime/reconcile.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/tracker\["save"\]/);
  expect(src).toMatch(/tracker\.mutate\(/);
});