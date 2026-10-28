import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOSSIER_AUTO_END,
  DOSSIER_AUTO_START,
  planDossierWrite,
  refreshDossierIfPresent,
  type DossierInput,
} from "../../src/dossier/dossier.js";

const input: DossierInput = {
  projectName: "demo",
  flows: [{ flowId: "f1", status: "verified", stage: "done", updatedAt: 1 }],
  now: Date.UTC(2026, 9, 17),
};

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-dossier-")); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe("refreshDossierIfPresent 不抹人写区", () => {
  it.each([
    ["人写、无标记", "# 我的北极星\n\n真人注意力每周 < 2 小时\n"],
    ["空白（并发写一半）", "   \n"],
    ["只有 START 没有 END", `# 北极星\n人写\n${DOSSIER_AUTO_START}\n旧机器区\n`],
    ["END 在 START 之前", `# 北极星\n${DOSSIER_AUTO_END}\n人写\n${DOSSIER_AUTO_START}\n`],
  ])("%s → 返回 false，文件字节不变", async (_label, content) => {
    const path = join(repo, "PROJECT.md");
    writeFileSync(path, content);
    const ok = await refreshDossierIfPresent(repo, input);
    expect(ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(content);
  });

  it("带完整标记 → 刷新机器区、保留人写区", async () => {
    const path = join(repo, "PROJECT.md");
    writeFileSync(path, `# 北极星\n真人注意力\n\n${DOSSIER_AUTO_START}\n旧\n${DOSSIER_AUTO_END}\n尾注\n`);
    const ok = await refreshDossierIfPresent(repo, input);
    expect(ok).toBe(true);
    const out = readFileSync(path, "utf8");
    expect(out).toContain("真人注意力");
    expect(out).toContain("尾注");
    expect(out).not.toContain("\n旧\n");
  });
});

describe("planDossierWrite", () => {
  it("不存在 → 写骨架（含两个标记）", () => {
    const plan = planDossierWrite(null, input);
    expect(plan.write).toBe(true);
    if (plan.write) {
      expect(plan.next).toContain(DOSSIER_AUTO_START);
      expect(plan.next).toContain(DOSSIER_AUTO_END);
    }
  });

  it("空白 → 拒写，原因含「空」", () => {
    const plan = planDossierWrite("\n\n", input);
    expect(plan.write).toBe(false);
    if (!plan.write) expect(plan.reason).toContain("空");
  });

  it("无标记 → 拒写，原因含「标记」", () => {
    const plan = planDossierWrite("# 人写\n", input);
    expect(plan.write).toBe(false);
    if (!plan.write) expect(plan.reason).toContain("标记");
  });
});