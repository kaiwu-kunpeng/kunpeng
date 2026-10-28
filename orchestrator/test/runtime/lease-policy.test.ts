import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LEASE_EXPIRY_FACTOR, leaseAgeMs, leaseExpired, leaseTtlForStage } from "../../src/runtime/lease-policy.js";
import { DEFAULT_IDLE_TIMEOUT_MS } from "../../src/agent/cli-runner.js";

describe("租约策略（作者锁定）", () => {
  it("ttl 随阶段放大", () => {
    expect(leaseTtlForStage("spec")).toBe(300_000);
    expect(leaseTtlForStage("audit")).toBe(120_000);
    expect(leaseTtlForStage("implement")).toBe(900_000);
    expect(leaseTtlForStage("repair")).toBe(900_000);
    expect(leaseTtlForStage("verify")).toBe(600_000);
    expect(leaseTtlForStage("whatever")).toBe(300_000);
  });
  it("过期 = 超过 2×ttl", () => {
    expect(LEASE_EXPIRY_FACTOR).toBe(2);
    expect(leaseAgeMs({ renewedAt: 1000 }, 4000)).toBe(3000);
    expect(leaseAgeMs({ renewedAt: 5000 }, 4000)).toBe(0);
    expect(leaseExpired({ renewedAt: 0, ttlMs: 1000 }, 2000)).toBe(false);
    expect(leaseExpired({ renewedAt: 0, ttlMs: 1000 }, 2001)).toBe(true);
  });
  it("空闲超时默认 10 分钟，两条路径都用它", () => {
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(600_000);
    const src = readFileSync(fileURLToPath(new URL("../../src/agent/cli-runner.ts", import.meta.url)), "utf8");
    expect(src).toContain("this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS");
  });
});