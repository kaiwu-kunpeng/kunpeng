import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpsGate, decideOpsGate, isTamperedOpsGate, listOpsGates, opsGateAuditPath } from "../../src/loop/ops-gate.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-opsgate-decidedby-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("运营门裁决必须署名并留审计行（作者锁定）", () => {
  it("decide 带署名 → 条目含 decidedBy/decidedAt，审计账本一行", async () => {
    const gate = await createOpsGate(root, { projectId: "pj", playbookId: "pb1", loopId: "l1", reason: "review" }, 1000);
    const decided = await decideOpsGate(root, gate.id, "approved", { by: "human", via: "cockpit", who: "xp" }, 3000);
    expect(decided).toMatchObject({ status: "approved", decidedAt: 3000, decidedBy: { by: "human", via: "cockpit", who: "xp" } });
    const lines = readFileSync(opsGateAuditPath(root), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ at: 3000, id: gate.id, playbookId: "pb1", loopId: "l1", decision: "approved", decidedBy: { by: "human", via: "cockpit", who: "xp" } });
    const stored = await listOpsGates(root);
    expect(stored[0]!.decidedBy).toEqual({ by: "human", via: "cockpit", who: "xp" });
    expect(isTamperedOpsGate(stored[0]!)).toBe(false);
  });

  it("没有署名 → 抛错且什么都不写", async () => {
    const gate = await createOpsGate(root, { projectId: "pj", playbookId: "pb1", loopId: "l1", reason: "review" }, 1000);
    await expect(decideOpsGate(root, gate.id, "approved", { by: "human", via: "" })).rejects.toThrow(/decidedBy/);
    await expect(decideOpsGate(root, gate.id, "approved", undefined as unknown as { by: "human"; via: string })).rejects.toThrow(/decidedBy/);
    expect((await listOpsGates(root))[0]!.status).toBe("pending");
    expect(existsSync(opsGateAuditPath(root))).toBe(false);
  });

  it("必先红 ②：篡改文件预写 approved（无 decidedBy）→ 裁决接口返回 null，isTamperedOpsGate=true，列表照常能读", async () => {
    mkdirSync(join(root, ".kunpeng", "ops-gates"), { recursive: true });
    const tampered = { id: "opsgate-tamper", projectId: "pj", playbookId: "pb9", loopId: "l9", reason: "预先批准", status: "approved", createdAt: 1, decidedAt: 2 };
    writeFileSync(join(root, ".kunpeng", "ops-gates", "opsgate-tamper.json"), JSON.stringify(tampered));
    expect(await decideOpsGate(root, "opsgate-tamper", "approved", { by: "human", via: "cockpit" })).toBeNull();
    const listed = await listOpsGates(root);
    expect(listed).toHaveLength(1);
    expect(isTamperedOpsGate(listed[0]!)).toBe(true);
    expect(existsSync(opsGateAuditPath(root))).toBe(false);
  });

  it("decidedBy 形状不合法的文件 → 解析抛错（不静默吞）", async () => {
    mkdirSync(join(root, ".kunpeng", "ops-gates"), { recursive: true });
    writeFileSync(join(root, ".kunpeng", "ops-gates", "opsgate-bad.json"), JSON.stringify({ id: "opsgate-bad", projectId: "pj", playbookId: "pb", loopId: "l", reason: "r", status: "approved", createdAt: 1, decidedBy: { by: "agent", via: "self" } }));
    await expect(listOpsGates(root)).rejects.toThrow(/decidedBy/);
  });
});