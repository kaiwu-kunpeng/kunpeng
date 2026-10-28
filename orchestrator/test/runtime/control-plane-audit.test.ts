import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTROL_PLANE_REPO_FILES, STATE_GATES_KEY, controlPlaneAuditPath, diffControlPlane, readControlPlaneAudit, recordControlPlaneChanges, snapshotControlPlane,
} from "../../src/runtime/control-plane-audit.js";

let repo: string;
let stateDir: string;
let clock = 1000;
const now = () => clock;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-cpa-repo-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-cpa-state-"));
  mkdirSync(join(repo, ".kunpeng"), { recursive: true });
  clock = 1000;
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

describe("控制面变更审计（作者锁定）", () => {
  test("快照覆盖四个仓内文件 + 运营门目录 + 状态目录 gates.json；缺文件记 absent", () => {
    writeFileSync(join(repo, ".kunpeng", "checks.json"), '{"lint":true}');
    mkdirSync(join(repo, ".kunpeng", "ops-gates"), { recursive: true });
    writeFileSync(join(repo, ".kunpeng", "ops-gates", "opsgate-1.json"), "{}");
    const snap = snapshotControlPlane(repo, stateDir);
    for (const f of CONTROL_PLANE_REPO_FILES) expect(Object.keys(snap.files)).toContain(f);
    expect(snap.files[".kunpeng/checks.json"]).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.files[".kunpeng/hooks.json"]).toBe("absent");
    expect(snap.files[".kunpeng/ops-gates/opsgate-1.json"]).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.files[STATE_GATES_KEY]).toBe("absent");
  });

  test("diff：首次 before=unseen；之后只列变化的键，按文件名排序", () => {
    const a = snapshotControlPlane(repo, stateDir);
    const first = diffControlPlane(undefined, a);
    expect(first.length).toBeGreaterThanOrEqual(5);
    expect(first.every((c) => c.before === "unseen")).toBe(true);
    writeFileSync(join(repo, ".kunpeng", "hooks.json"), '{"preMerge":["true"]}');
    writeFileSync(join(stateDir, "gates.json"), '{"scope":"observe"}');
    const b = snapshotControlPlane(repo, stateDir);
    const changes = diffControlPlane(a, b);
    expect(changes.map((c) => c.file)).toEqual([".kunpeng/hooks.json", STATE_GATES_KEY]);
    expect(changes[0]).toMatchObject({ before: "absent" });
    expect(changes[0]!.after).toMatch(/^[0-9a-f]{64}$/);
  });

  test("record：首次落基线行；改 hooks.json 后恰好一行；无变化零行；账本可读回", () => {
    const first = recordControlPlaneChanges(repo, { stateDir, now });
    expect(first.length).toBeGreaterThanOrEqual(5);
    clock = 2000;
    writeFileSync(join(repo, ".kunpeng", "hooks.json"), '{"preMerge":["exit 0"]}');
    const second = recordControlPlaneChanges(repo, { stateDir, now });
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ at: 2000, repoRoot: repo, file: ".kunpeng/hooks.json", before: "absent" });
    clock = 3000;
    expect(recordControlPlaneChanges(repo, { stateDir, now })).toEqual([]);
    expect(existsSync(controlPlaneAuditPath(stateDir))).toBe(true);
    const lines = readFileSync(controlPlaneAuditPath(stateDir), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(first.length + 1);
    const tail = readControlPlaneAudit(stateDir, 1);
    expect(tail).toHaveLength(1);
    expect(tail[0]).toMatchObject({ file: ".kunpeng/hooks.json", at: 2000 });
    expect(readControlPlaneAudit(stateDir, 1000)).toHaveLength(first.length + 1);
  });

  test("账本不存在 → []；状态目录不可写 → 不抛只 warn 并返回 []", () => {
    expect(readControlPlaneAudit(join(stateDir, "nope"))).toEqual([]);
    const file = join(stateDir, "plain-file");
    writeFileSync(file, "x");
    const warns: string[] = [];
    expect(() => recordControlPlaneChanges(repo, { stateDir: join(file, "sub"), now, warn: (m) => warns.push(m) })).not.toThrow();
    expect(warns.length).toBeGreaterThanOrEqual(1);
  });
});