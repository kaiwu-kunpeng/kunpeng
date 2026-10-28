import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEGRADE_LADDER,
  EMPTY_RESPONSE_TTL_MS,
  backendHealthPath,
  downBackends,
  downModels,
  effectiveChain,
  loadBackendHealth,
  markBackendDown,
  markModelDown,
  nextModel,
  resolveBackendDownTtlMs,
} from "../../src/agent/backend-health.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-bh-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("后端健康文件（作者锁定）", () => {
  it("路径、TTL 解析、梯子固定", () => {
    expect(backendHealthPath(join(dir, ".kunpeng"))).toBe(join(dir, ".kunpeng", "backend-health.json"));
    expect(resolveBackendDownTtlMs({})).toBe(30 * 60_000);
    expect(resolveBackendDownTtlMs({ KUNPENG_BACKEND_DOWN_TTL_MS: "120000" })).toBe(120_000);
    expect(resolveBackendDownTtlMs({ KUNPENG_BACKEND_DOWN_TTL_MS: "abc" })).toBe(30 * 60_000);
    expect(EMPTY_RESPONSE_TTL_MS).toBe(5 * 60_000);
    expect(DEGRADE_LADDER.claude[0]).toBe("claude-opus-5");
    expect(DEGRADE_LADDER.codex[0]).toBe("gpt-6-astra");
    expect(DEGRADE_LADDER.claude.length).toBeGreaterThanOrEqual(3);
    expect(DEGRADE_LADDER.codex.length).toBeGreaterThanOrEqual(3);
  });

  it("缺文件/坏 JSON → 空；标记落盘；过期条目读回时被剔除", () => {
    const p = backendHealthPath(join(dir, ".kunpeng"));
    expect(loadBackendHealth(p, 1000)).toEqual({ backends: {}, models: {} });
    writeFileSync(join(dir, "bad.json"), "{nope", "utf8");
    expect(loadBackendHealth(join(dir, "bad.json"), 1000)).toEqual({ backends: {}, models: {} });
    const f1 = markBackendDown(p, "codex", { kind: "quota", reason: "usage limit reached", ttlMs: 10_000, now: 1000 });
    expect(f1.backends.codex).toEqual({ downUntil: 11_000, reason: "usage limit reached", kind: "quota", at: 1000 });
    expect(existsSync(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf8")).backends.codex.downUntil).toBe(11_000);
    markModelDown(p, "claude", "claude-opus-5", { kind: "model-unavailable", reason: "model not found", ttlMs: 10_000, now: 2000 });
    const at5k = loadBackendHealth(p, 5000);
    expect([...downBackends(at5k, 5000)]).toEqual(["codex"]);
    expect([...downModels(at5k, "claude", 5000)]).toEqual(["claude-opus-5"]);
    expect([...downModels(at5k, "codex", 5000)]).toEqual([]);
    const at20k = loadBackendHealth(p, 20_000);
    expect(at20k).toEqual({ backends: {}, models: {} });
    expect(markBackendDown(p, "claude", { kind: "auth", reason: "401", ttlMs: 0, now: 20_000 }).backends.claude).toBeUndefined();
  });

  it("nextModel 沿梯子往下找未下线的一档", () => {
    expect(nextModel("claude", "claude-opus-5", new Set())).toBe("claude-sonnet-5");
    expect(nextModel("claude", "claude-opus-5", new Set(["claude-sonnet-5"]))).toBe("claude-haiku-4-5-20251001");
    expect(nextModel("claude", "claude-haiku-4-5-20251001", new Set())).toBeUndefined();
    expect(nextModel("codex", undefined, new Set(["gpt-6-astra"]))).toBe("gpt-5.6-terra");
    expect(nextModel("codex", "gpt-5.6-luna", new Set())).toBeUndefined();
  });

  it("effectiveChain：固定顺序、剔除未启用与下线，展开下线明细", () => {
    const p = backendHealthPath(join(dir, ".kunpeng"));
    markBackendDown(p, "claude", { kind: "auth", reason: "401", ttlMs: 10_000, now: 1000 });
    markModelDown(p, "codex", "gpt-6-astra", { kind: "model-unavailable", reason: "retired", ttlMs: 10_000, now: 1000 });
    const file = loadBackendHealth(p, 2000);
    const chain = effectiveChain({ enabled: ["claude", "codex"], file, now: 2000 });
    expect(chain.order).toEqual(["codex"]);
    expect(chain.down).toEqual([{ backend: "claude", reason: "401", kind: "auth", until: 11_000 }]);
    expect(chain.modelsDown).toEqual([{ backend: "codex", model: "gpt-6-astra", reason: "retired", kind: "model-unavailable", until: 11_000 }]);
    expect(effectiveChain({ enabled: ["codex"], file: { backends: {}, models: {} }, now: 0 }).order).toEqual(["codex"]);
    expect(effectiveChain({ enabled: ["claude", "codex"], file: { backends: {}, models: {} }, now: 0 }).order).toEqual(["claude", "codex"]);
  });
});