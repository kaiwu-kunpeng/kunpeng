import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { mergeAndClearGate, runMergeCommand } from "../src/runtime/merge-gate.js";
import { SwitchboardStore, newMessage } from "../src/switchboard/store.js";

let repo: string;
let prevKunpengState: string | undefined;
let prevKunpengInstance: string | undefined;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-mg-"));
  prevKunpengState = process.env.KUNPENG_STATE;
  prevKunpengInstance = process.env.KUNPENG_INSTANCE;
  process.env.KUNPENG_STATE = join(repo, "global-state");
  process.env.KUNPENG_INSTANCE = "merge-test";
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

test("合并成功 -> kp/f1 并入 main 且 humanGate 被清", async () => {
  const r = await mergeAndClearGate(repo, "f1", "main");
  expect(r.ok).toBe(true);
  expect(await simpleGit(repo).raw(["branch", "--merged", "main"])).toContain("kp/f1");
  expect((await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!.humanGate).toBeUndefined();
});

test("flowId 为空 -> 拒绝", async () => {
  expect((await mergeAndClearGate(repo, "  ", "main")).ok).toBe(false);
  expect((await runMergeCommand([], repo)).ok).toBe(false);
});

test("runMergeCommand 默认 base=main、解析 flowId 并清门", async () => {
  const r = await runMergeCommand(["f1"], repo);
  expect(r.ok).toBe(true);
  expect((await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!.humanGate).toBeUndefined();
});

test("review block -> 不合并且保留 humanGate", async () => {
  const r = await mergeAndClearGate(repo, "f1", "main", {
    review: async () => ({ block: true, findings: ["X"] }),
  });

  expect(r).toEqual({ ok: false, error: "合并前审查未通过：X" });
  expect(await simpleGit(repo).raw(["branch", "--merged", "main"])).not.toContain("kp/f1");
  expect((await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!.humanGate).toEqual({
    gate: "合并主干 (人工门#1)",
    what: "kp/f1 → main",
  });
});

test("review pass -> 合并成功且清门", async () => {
  const r = await mergeAndClearGate(repo, "f1", "main", {
    review: async () => ({ block: false }),
  });

  expect(r.ok).toBe(true);
  expect(await simpleGit(repo).raw(["branch", "--merged", "main"])).toContain("kp/f1");
  expect((await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!.humanGate).toBeUndefined();
});

test("review 收到非空 diff 入参", async () => {
  let seen: { repoRoot: string; flowId: string; base: string; diff: string } | undefined;
  const r = await mergeAndClearGate(repo, "f1", "main", {
    review: async (ctx) => {
      seen = ctx;
      return { block: true, findings: ["stop"] };
    },
  });

  expect(r.ok).toBe(false);
  expect(seen).toMatchObject({ repoRoot: repo, flowId: "f1", base: "main" });
  expect(seen!.diff).toContain("b.txt");
  expect(seen!.diff).toContain("feat");
});

test("合并前收到 stop 信号 -> 回执、不合并且保留 humanGate", async () => {
  const store = new SwitchboardStore(join(process.env.KUNPENG_STATE!, "switchboard"));
  await store.append(newMessage(
    { from: "operator", to: "merge-test", body: "停止合并", kind: "stop" },
    { now: () => 1, id: () => "stop-1" },
  ));

  const r = await mergeAndClearGate(repo, "f1", "main");

  expect(r.ok).toBe(false);
  expect(r.error).toContain("合并前收到停止信号");
  expect(await simpleGit(repo).raw(["branch", "--merged", "main"])).not.toContain("kp/f1");
  expect((await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!.humanGate).toEqual({
    gate: "合并主干 (人工门#1)",
    what: "kp/f1 → main",
  });

  const messages = await store.list();
  expect(messages.find((msg) => msg.id === "stop-1")?.read).toBe(true);
  expect(messages).toContainEqual(expect.objectContaining({
    from: "merge-test",
    to: "operator",
    topic: "stop-1",
    body: "已停止",
    kind: "receipt",
  }));
});
