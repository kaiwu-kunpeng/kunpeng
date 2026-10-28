import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { mergeAndClearGate, runMergeCommand } from "../../src/runtime/merge-gate.js";
import { classifySensitiveFiles, SENSITIVE_GATE_NOTE } from "../../src/runtime/sensitive-paths.js";

describe("敏感名单补齐", () => {
  it.each([
    "orchestrator/src/loop/guardian.ts",
    "orchestrator/src/loop/guardian-report.ts",
    "orchestrator/src/cli-commands/maintain-guardian.ts",
    "orchestrator/src/plan/spec-lint.ts",
    "orchestrator/src/spec/spec-lint.ts",
    "orchestrator/src/verify/eval-asset-guard.ts",
    "orchestrator/src/runtime/sensitive-branch.ts",
    "REVIEW.md",
    ".kunpeng/playbooks/tl-geo-audit.md",
    ".kunpeng/playbooks/any-new-playbook.md",
  ])("%s 判敏感", (file) => {
    expect(classifySensitiveFiles([file]).sensitive).toBe(true);
  });

  it.each([
    "orchestrator/test/loop/guardian.test.ts",
    "orchestrator/src/loop/guardian-ui-helper.ts",
    "orchestrator/src/plan/spec-lint-format.ts",
    "docs/REVIEW-notes.md",
    "docs/playbooks/readme.md",
  ])("%s 不判敏感", (file) => {
    expect(classifySensitiveFiles([file]).sensitive).toBe(false);
  });
});

describe("mergeAndClearGate 停车场", () => {
  let repo: string;
  let prevState: string | undefined;
  let prevInstance: string | undefined;
  const noLlm = { guardTests: false as const, stopCheckpoint: false as const, review: async () => ({ block: false }) };

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "kp-park-"));
    prevState = process.env.KUNPENG_STATE;
    prevInstance = process.env.KUNPENG_INSTANCE;
    process.env.KUNPENG_STATE = join(repo, "global-state");
    process.env.KUNPENG_INSTANCE = "park-test";
    const g = simpleGit(repo);
    await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
    await g.checkoutLocalBranch("main");
    writeFileSync(join(repo, "a.txt"), "base"); await g.add("a.txt"); await g.commit("base");
    await g.checkoutLocalBranch("kp/f1");
    mkdirSync(join(repo, "orchestrator", "src", "loop"), { recursive: true });
    writeFileSync(join(repo, "orchestrator", "src", "loop", "guardian.ts"), "export const loosened = true;\n");
    await g.add("."); await g.commit("loosen guardian");
    await g.checkout("main");
    const t = new FlowTracker(join(repo, ".kunpeng", "state"));
    await t.start("f1", "改门的流");
    await t.finish("f1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f1 → main" });
  });
  afterEach(() => {
    if (prevState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = prevState;
    if (prevInstance === undefined) delete process.env.KUNPENG_INSTANCE; else process.env.KUNPENG_INSTANCE = prevInstance;
    rmSync(repo, { recursive: true, force: true });
  });

  async function mainSha(): Promise<string> {
    return (await simpleGit(repo).raw(["rev-parse", "main"])).trim();
  }

  it("默认调用（autopilot/值班员路径）遇敏感改动 → 停车，不合并", async () => {
    const before = await mainSha();
    const r = await mergeAndClearGate(repo, "f1", "main", noLlm);
    expect(r.ok).toBe(false);
    expect(r.error ?? "").toContain(SENSITIVE_GATE_NOTE);
    expect(r.error ?? "").toContain("门与审查规则源码");
    expect(await mainSha()).toBe(before);
    const flow = (await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!;
    expect(flow.gateHold?.kind).toBe("sensitive-park");
    expect(flow.sensitive?.hits.length ?? 0).toBeGreaterThan(0);
    expect(flow.humanGate).toBeDefined();
  });

  it("runMergeCommand 不带 --allow-sensitive → 停车", async () => {
    const before = await mainSha();
    const r = await runMergeCommand(["f1"], repo, noLlm);
    expect(r.ok).toBe(false);
    expect(await mainSha()).toBe(before);
  });

  it("runMergeCommand 带 --allow-sensitive → 合并，base 仍为 main", async () => {
    const r = await runMergeCommand(["f1", "--allow-sensitive"], repo, noLlm);
    expect(r.ok).toBe(true);
    expect(await simpleGit(repo).raw(["branch", "--merged", "main"])).toContain("kp/f1");
  });

  it("allowSensitive: true → 合并", async () => {
    const r = await mergeAndClearGate(repo, "f1", "main", { ...noLlm, allowSensitive: true });
    expect(r.ok).toBe(true);
  });

  it("敏感判定抛异常 → 判不定也停车，不合并", async () => {
    const before = await mainSha();
    const r = await mergeAndClearGate(repo, "f1", "main", {
      ...noLlm,
      sensitiveCheck: async () => { throw new Error("diff unavailable"); },
    });
    expect(r.ok).toBe(false);
    expect(await mainSha()).toBe(before);
    const flow = (await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!;
    expect(flow.gateHold?.kind).toBe("sensitive-park");
  });

  it("非敏感改动不受影响", async () => {
    const r = await mergeAndClearGate(repo, "f1", "main", { ...noLlm, sensitiveCheck: async () => [] });
    expect(r.ok).toBe(true);
  });
});