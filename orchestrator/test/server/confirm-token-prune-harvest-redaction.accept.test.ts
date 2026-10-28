import { describe, expect, test } from "vitest";
import { redactSensitive } from "../../src/knowledge/session-harvest.js";
import { CONFIRM_TOKEN_TTL_MS, consumeConfirmToken, issueConfirmToken, pendingConfirmTokenCount } from "../../src/server/second-confirm.js";

describe("L4 确认令牌过期清理（作者锁定）", () => {
  test("签发时清掉已过期、从没被确认的令牌；未过期的保留且仍可用", () => {
    const base = 10_000_000;
    const before = pendingConfirmTokenCount();
    for (let i = 0; i < 5; i += 1) issueConfirmToken(`stale:${i}`, base);
    expect(pendingConfirmTokenCount()).toBe(before + 5);
    const fresh = issueConfirmToken("fresh:1", base + CONFIRM_TOKEN_TTL_MS + 1);
    expect(pendingConfirmTokenCount()).toBeLessThanOrEqual(before + 1);
    expect(consumeConfirmToken("fresh:1", fresh, base + CONFIRM_TOKEN_TTL_MS + 2)).toBe(true);
  });
});

const j = (...parts: string[]): string => parts.join("");

describe("会话采集脱敏补漏（作者锁定）", () => {
  test.each([
    [j('{"api_key": "abc', '123secretvalue"}'), "abc123secretvalue"],
    [j('{"Password":"hunter', '2hunter2"}'), "hunter2hunter2"],
    [j("config: client_secret = 'x' and token=ZZ", "TOPSECRET99"), "ZZTOPSECRET99"],
    [j("export password=pa", "ss-word-1"), "pass-word-1"],
    [j("postgresql://neondb_owner:w7eFAKE", "PASS123@ep-x.aws.neon.tech/db"), "w7eFAKEPASS123"],
    [j("mongodb+srv://bob:s3cr", "etpw@cluster0.mongodb.net"), "s3cretpw"],
  ])("%s 里的凭证被抹掉", (input, secret) => {
    const out = redactSensitive(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("<密钥>");
  });

  test("连接串保留协议与用户名、只抹密码", () => {
    expect(redactSensitive(j("postgresql://neondb_owner:abcdef", "123456@host/db"))).toContain("postgresql://neondb_owner:<密钥>@host/db");
  });

  test("既有规则不变", () => {
    expect(redactSensitive(j("API_KEY=sk-", "abcdefghijklmnop"))).toContain("API_KEY=<密钥>");
    expect(redactSensitive("mail me at a.b@example.com")).toContain("<邮箱>");
    expect(redactSensitive("no secrets here")).toBe("no secrets here");
  });
});