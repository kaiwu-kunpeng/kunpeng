import { describe, it, expect } from "vitest";
import {
  WORKER_TOKEN_VERSION,
  WORKER_PROTOCOL_VERSION,
  signWorkerToken,
  verifyWorkerToken,
  newMachineId,
  checkWorkerProtocol,
} from "../../src/server/worker/worker-token.js";
import { signSession, verifySession } from "../../src/server/auth.js";

const SECRET = "s3cr3t-for-worker-token-test";
const NOW = 1_700_000_000_000;
const MAX_AGE = 30 * 24 * 3600 * 1000;

describe("worker token", () => {
  it("版本常量是 w1", () => {
    expect(WORKER_TOKEN_VERSION).toBe("w1");
  });

  it("签发的令牌以 w1. 开头且共 5 段", () => {
    const t = signWorkerToken("acc-1", "m-abc", SECRET, NOW);
    expect(t.startsWith("w1.")).toBe(true);
    expect(t.split(".").length).toBe(5);
  });

  it("往返取回同样的 accountId 与 machineId", () => {
    const t = signWorkerToken("acc-1", "m-abc", SECRET, NOW);
    const parsed = verifyWorkerToken(t, SECRET, NOW + 1000, MAX_AGE);
    expect(parsed).not.toBeNull();
    expect(parsed?.accountId).toBe("acc-1");
    expect(parsed?.machineId).toBe("m-abc");
    expect(parsed?.issuedAt).toBe(NOW);
  });

  it("verifySession 必须拒绝 worker 令牌(worker 令牌不得用于 web 鉴权)", () => {
    const t = signWorkerToken("acc-1", "m-abc", SECRET, NOW);
    expect(verifySession(t, SECRET, NOW + 1000, MAX_AGE)).toBeNull();
  });

  it("verifyWorkerToken 必须拒绝普通 session 令牌", () => {
    const s = signSession("acc-1", "prof-1", SECRET, NOW);
    expect(verifyWorkerToken(s, SECRET, NOW + 1000, MAX_AGE)).toBeNull();
  });

  it("篡改签名后校验失败", () => {
    const t = signWorkerToken("acc-1", "m-abc", SECRET, NOW);
    const parts = t.split(".");
    parts[4] = parts[4].replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(verifyWorkerToken(parts.join("."), SECRET, NOW + 1000, MAX_AGE)).toBeNull();
  });

  it("换密钥校验失败", () => {
    const t = signWorkerToken("acc-1", "m-abc", SECRET, NOW);
    expect(verifyWorkerToken(t, "another-secret", NOW + 1000, MAX_AGE)).toBeNull();
  });

  it("超过 maxAgeMs 校验失败", () => {
    const t = signWorkerToken("acc-1", "m-abc", SECRET, NOW);
    expect(verifyWorkerToken(t, SECRET, NOW + MAX_AGE + 1, MAX_AGE)).toBeNull();
  });

  it("签发时间在未来的令牌校验失败", () => {
    const t = signWorkerToken("acc-1", "m-abc", SECRET, NOW);
    expect(verifyWorkerToken(t, SECRET, NOW - 1000, MAX_AGE)).toBeNull();
  });

  it("段数不对的字符串校验失败", () => {
    expect(verifyWorkerToken("w1.acc.machine", SECRET, NOW, MAX_AGE)).toBeNull();
  });
});

describe("machine id", () => {
  it("返回 32 位小写十六进制", () => {
    expect(newMachineId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("两次调用不相同", () => {
    expect(newMachineId()).not.toBe(newMachineId());
  });
});

describe("protocol handshake", () => {
  it("协议版本是正整数", () => {
    expect(Number.isInteger(WORKER_PROTOCOL_VERSION)).toBe(true);
    expect(WORKER_PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it("版本相同则 ok", () => {
    expect(checkWorkerProtocol(WORKER_PROTOCOL_VERSION)).toEqual({ ok: true });
  });

  it("版本不同则失败,且 reason 同时含两个版本号", () => {
    const other = WORKER_PROTOCOL_VERSION + 7;
    const r = checkWorkerProtocol(other);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.reason).toContain(String(other));
      expect(r.reason).toContain(String(WORKER_PROTOCOL_VERSION));
    }
  });
});