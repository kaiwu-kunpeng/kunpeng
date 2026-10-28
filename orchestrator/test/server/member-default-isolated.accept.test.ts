import { describe, expect, test } from "vitest";
import { accountHostCeiling } from "../../src/server/auth.js";
import { resolveHostToolPolicy } from "../../src/server/worker/host-permissions.js";

describe("member 未设上限缺省 isolated（审计 P0 的代码兜底，作者锁定）", () => {
  test("member 未设 → isolated；对话只剩 WebFetch/WebSearch", () => {
    const ceiling = accountHostCeiling({ role: "member" });
    expect(ceiling).toBe("isolated");
    expect(resolveHostToolPolicy(ceiling, "full").allowTools).toEqual(["WebFetch", "WebSearch"]);
  });

  test("owner 未设、旧形态账号（无 role）未设 → 仍为 full（既有行为不变）", () => {
    expect(accountHostCeiling({ role: "owner" })).toBe("full");
    expect(accountHostCeiling({})).toBe("full");
  });

  test("显式设置优先：member 可以被显式放宽，owner 可以被显式收紧", () => {
    expect(accountHostCeiling({ role: "member", hostCeiling: "full" })).toBe("full");
    expect(accountHostCeiling({ role: "member", hostCeiling: "readonly" })).toBe("readonly");
    expect(accountHostCeiling({ role: "owner", hostCeiling: "isolated" })).toBe("isolated");
  });

  test("不认识的上限值仍 fail-closed 为 isolated，与角色无关", () => {
    expect(accountHostCeiling({ role: "owner", hostCeiling: "root" } as never)).toBe("isolated");
  });
});