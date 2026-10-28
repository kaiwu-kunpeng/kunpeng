import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMaintenance, logMaintenance, maintenanceMinutes } from "./maintenance-ledger.js";

function tmpState(): string {
  return mkdtempSync(join(tmpdir(), "kp-mnt-"));
}

describe("maintenance ledger", () => {
  it("log 落盘 <stateDir>/maintenance-ledger.json 且 list 可读", () => {
    const dir = tmpState();
    const entry = logMaintenance(dir, "人工审读 vendored 技能", 30);
    expect(entry.minutes).toBe(30);
    expect(entry.what).toContain("审读");
    const file = join(dir, "maintenance-ledger.json");
    expect(existsSync(file)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(Array.isArray(onDisk)).toBe(true);
    expect(listMaintenance(dir).length).toBe(1);
    expect(listMaintenance(dir)[0].id).toBe(entry.id);
  });

  it("maintenanceMinutes 求和并支持 sinceMs 过滤", () => {
    const dir = tmpState();
    logMaintenance(dir, "a", 10);
    logMaintenance(dir, "b", 20);
    expect(maintenanceMinutes(dir)).toBe(30);
    expect(maintenanceMinutes(dir, Date.now() + 60_000)).toBe(0);
    expect(maintenanceMinutes(dir, 0)).toBe(30);
  });

  it("空目录 list 返回空数组", () => {
    const dir = tmpState();
    expect(listMaintenance(dir)).toEqual([]);
    expect(maintenanceMinutes(dir)).toBe(0);
  });
});