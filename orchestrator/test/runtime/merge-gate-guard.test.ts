import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { mergeAndClearGate } from "../../src/runtime/merge-gate.js";

let repo: string;
let prevKunpengState: string | undefined;
let prevKunpengInstance: string | undefined;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-mg-guard-"));
  prevKunpengState = process.env.KUNPENG_STATE;
  prevKunpengInstance = process.env.KUNPENG_INSTANCE;
  process.env.KUNPENG_STATE = join(repo, "global-state");
  process.env.KUNPENG_INSTANCE = "merge-guard-test";
  const g = simpleGit(repo);
  await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, "a.txt"), "base"); await g.add("a.txt"); await g.commit("base");
  await g.checkoutLocalBranch("kp/f1");
  writeFileSync(join(repo, "b.txt"), "feat"); await g.add("b.txt"); await g.commit("feat on f1");
  await g.checkout("main");
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  await t.start("f1", "造门用");
  await t.finish("f1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f1 → main" });
});
afterEach(() => {
  if (prevKunpengState === undefined) delete process.env.KUNPENG_STATE;
  else process.env.KUNPENG_STATE = prevKunpengState;
  if (prevKunpengInstance === undefined) delete process.env.KUNPENG_INSTANCE;
  else process.env.KUNPENG_INSTANCE = prevKunpengInstance;
  rmSync(repo, { recursive: true, force: true });
});

const flow = async () => (await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!;

test("守门测试红 → 不合并、门保留、gateHold=guard-red，且守门测试跑在合并锁之外", async () => {
  let lockExistedDuringGuard: boolean | undefined;
  const r = await mergeAndClearGate(repo, "f1", "main", {
    guardTests: async () => {
      lockExistedDuringGuard = existsSync(join(repo, ".kunpeng", "locks", "merge.lock"));
      return { status: "red", summary: "× sensitive-paths 漏了 hooks.json", durationMs: 5 };
    },
  });
  expect(r.ok).toBe(false);
  expect(r.error).toContain("守门测试碰红");
  expect(r.error).toContain("× sensitive-paths 漏了 hooks.json");
  expect(r.guard?.status).toBe("red");
  expect(lockExistedDuringGuard).toBe(false);
  expect(await simpleGit(repo).raw(["branch", "--merged", "main"])).not.toContain("kp/f1");
  const s = await flow();
  expect(s.humanGate).toBeDefined();
  expect(s.gateHold?.kind).toBe("guard-red");
  expect(s.gateHold?.reason).toContain("sensitive-paths");
  expect(typeof s.gateHold?.at).toBe("number");
});

test("守门测试绿 → 合并、清门、gateHold 被清", async () => {
  await new FlowTracker(join(repo, ".kunpeng", "state")).setGateHold("f1", { kind: "guard-red", reason: "上一轮红", at: 1 });
  const r = await mergeAndClearGate(repo, "f1", "main", {
    guardTests: async () => ({ status: "green", summary: "守门测试全绿（3 组）", durationMs: 5 }),
  });
  expect(r.ok).toBe(true);
  expect(r.guard?.status).toBe("green");
  const s = await flow();
  expect(s.humanGate).toBeUndefined();
  expect(s.gateHold).toBeUndefined();
});

test("guardTests=false 与缺省 runner（临时仓库无 orchestrator）都按 skipped 放行", async () => {
  const off = await mergeAndClearGate(repo, "f1", "main", { guardTests: false });
  expect(off.ok).toBe(true);
  expect(off.guard?.status).toBe("skipped");
});

test("缺省 runner 在无 orchestrator 的仓库里 skipped 且合并成功", async () => {
  const r = await mergeAndClearGate(repo, "f1", "main");
  expect(r.ok).toBe(true);
  expect(r.guard?.status).toBe("skipped");
});

test("审查闸拒合 → gateHold=review-block；钩子失败 → hook-failed", async () => {
  const blocked = await mergeAndClearGate(repo, "f1", "main", {
    guardTests: false,
    review: async () => ({ block: true, findings: ["X 有问题"] }),
  });
  expect(blocked.ok).toBe(false);
  expect((await flow()).gateHold?.kind).toBe("review-block");
  expect((await flow()).gateHold?.reason).toContain("X 有问题");
  writeFileSync(join(repo, ".kunpeng", "hooks.json"), JSON.stringify({ preMerge: ["exit 3"] }));
  const hooked = await mergeAndClearGate(repo, "f1", "main", { guardTests: false });
  expect(hooked.ok).toBe(false);
  expect(hooked.error).toContain("preMerge 钩子未通过");
  expect((await flow()).gateHold?.kind).toBe("hook-failed");
});

test("守门 runner 抛异常 → 折成 red，不合并", async () => {
  const r = await mergeAndClearGate(repo, "f1", "main", { guardTests: async () => { throw new Error("worktree 炸了"); } });
  expect(r.ok).toBe(false);
  expect(r.guard?.status).toBe("red");
  expect(r.guard?.summary).toContain("worktree 炸了");
  expect((await flow()).gateHold?.kind).toBe("guard-red");
});