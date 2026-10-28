import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateModeFor, gatesConfigPath, legacyRepoGatesConfigPath, readGatesConfig, warnLegacyRepoGatesConfig } from "../../src/runtime/gate-mode.js";
import { overlapGateMode } from "../../src/loop/dispatch-overlap.js";

let repo: string;
let stateDir: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-gm-home-repo-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-gm-home-state-"));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

describe("闸门模式只认 env 与状态目录 gates.json（作者锁定）", () => {
  test("路径函数", () => {
    expect(gatesConfigPath("/s")).toBe(join("/s", "gates.json"));
    expect(legacyRepoGatesConfigPath("/r")).toBe(join("/r", ".kunpeng", "gates.json"));
  });

  test("状态目录 gates.json 生效；env 压过它；缺文件=block", () => {
    const env = { KUNPENG_STATE: stateDir };
    expect(gateModeFor("scope", repo, env, () => {})).toBe("block");
    writeFileSync(gatesConfigPath(stateDir), JSON.stringify({ scope: "observe", audit: "block" }));
    expect(readGatesConfig(stateDir, () => {})).toEqual({ scope: "observe", audit: "block" });
    expect(gateModeFor("scope", repo, env, () => {})).toBe("observe");
    expect(gateModeFor("audit", repo, env, () => {})).toBe("block");
    expect(gateModeFor("scope", repo, { ...env, KUNPENG_GATE_MODE_SCOPE: "block" }, () => {})).toBe("block");
  });

  test("仓内 .kunpeng/gates.json 惰性：写 observe 也不放行，只 warn 一句'已不再生效'", () => {
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(legacyRepoGatesConfigPath(repo), JSON.stringify({ scope: "observe", audit: "observe", "merge-review": "observe" }));
    const warns: string[] = [];
    expect(gateModeFor("scope", repo, { KUNPENG_STATE: stateDir }, (m) => warns.push(m))).toBe("block");
    expect(gateModeFor("merge-review", repo, { KUNPENG_STATE: stateDir }, (m) => warns.push(m))).toBe("block");
    expect(warns.length).toBeGreaterThanOrEqual(2);
    expect(warns.every((m) => m.includes("已不再生效"))).toBe(true);
    expect(warnLegacyRepoGatesConfig(repo, stateDir, () => {})).toBe(true);
    expect(warnLegacyRepoGatesConfig(undefined, stateDir, () => {})).toBe(false);
  });

  test("dispatch-overlap 同样只认状态目录：仓内 block 不生效，状态目录 block 生效", () => {
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(legacyRepoGatesConfigPath(repo), JSON.stringify({ "dispatch-overlap": "block" }));
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir }, () => {})).toBe("observe");
    writeFileSync(gatesConfigPath(stateDir), JSON.stringify({ "dispatch-overlap": "block" }));
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir }, () => {})).toBe("block");
  });
});