import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import {
  accountHostCeiling,
  addAccount,
  editAccount,
  type AuthConfig,
} from "../../src/server/auth.js";
import { resolveHostPermissions } from "../../src/server/worker/host-permissions.js";

function baseConfig(): AuthConfig {
  return {
    secret: "s".repeat(32),
    accounts: [{
      username: "老账号", salt: "aa", hash: "bb",
      profileId: "home", role: "owner", updatedAt: 1,
    }],
  };
}

describe("accountHostCeiling 必须 fail-closed", () => {
  test("三个合法值原样返回", () => {
    for (const v of ["full", "readonly", "isolated"] as const) {
      expect(accountHostCeiling({ hostCeiling: v })).toBe(v);
    }
  });

  test("字段缺失 → full(既有账号行为不变)", () => {
    expect(accountHostCeiling({})).toBe("full");
    expect(accountHostCeiling({ hostCeiling: undefined })).toBe("full");
  });

  test("账号为空 / null → isolated(查不到账号 = 最严)", () => {
    expect(accountHostCeiling(null)).toBe("isolated");
    expect(accountHostCeiling(undefined)).toBe("isolated");
  });

  test("任何不认识的值 → isolated,绝不回落 full", () => {
    for (const bad of ["", "FULL", "none", "随便", 42, true, {}, []] as unknown[]) {
      expect(accountHostCeiling({ hostCeiling: bad } as never), String(bad)).toBe("isolated");
    }
  });

  test("纯函数:多次调用一致", () => {
    expect(accountHostCeiling({ hostCeiling: "readonly" })).toBe(accountHostCeiling({ hostCeiling: "readonly" }));
  });
});

describe("账号增改的白名单", () => {
  test("addAccount 写入合法上限", () => {
    const cfg = addAccount(baseConfig(), {
      username: "新人", password: "pw", profileId: "home",
      salt: "cc", now: 2, hostCeiling: "readonly",
    } as never);
    const account = cfg.accounts.find((a) => a.username === "新人");
    expect(account?.hostCeiling).toBe("readonly");
  });

  test("addAccount 忽略非法上限（新建账号缺省 member → 未设上限按 isolated）", () => {
    const cfg = addAccount(baseConfig(), {
      username: "新人2", password: "pw", profileId: "home",
      salt: "dd", now: 2, hostCeiling: "乱写的",
    } as never);
    const account = cfg.accounts.find((a) => a.username === "新人2");
    expect(account?.hostCeiling).toBeUndefined();
    expect(accountHostCeiling(account)).toBe("isolated");
  });

  test("editAccount 能改上限", () => {
    const cfg = editAccount(baseConfig(), { username: "老账号", now: 3, hostCeiling: "isolated" } as never);
    expect(cfg.accounts[0].hostCeiling).toBe("isolated");
  });

  test("editAccount 忽略非法上限,不破坏既有值", () => {
    const withCeiling = editAccount(baseConfig(), { username: "老账号", now: 3, hostCeiling: "readonly" } as never);
    const after = editAccount(withCeiling, { username: "老账号", now: 4, hostCeiling: 999 } as never);
    expect(after.accounts[0].hostCeiling).toBe("readonly");
  });

  test("不传 hostCeiling 时不动既有值", () => {
    const withCeiling = editAccount(baseConfig(), { username: "老账号", now: 3, hostCeiling: "isolated" } as never);
    const after = editAccount(withCeiling, { username: "老账号", now: 4, profileId: "work" } as never);
    expect(after.accounts[0].hostCeiling).toBe("isolated");
    expect(after.accounts[0].profileId).toBe("work");
  });

  test("既有账号(无该字段)照常可编辑", () => {
    const cfg = editAccount(baseConfig(), { username: "老账号", now: 5, profileId: "work" } as never);
    expect(cfg.accounts[0].profileId).toBe("work");
    expect(accountHostCeiling(cfg.accounts[0])).toBe("full");
  });
});

describe("上限真的收紧了权限", () => {
  test("readonly 上限即便满血模式也 deny 写类与 Bash", () => {
    const deny = resolveHostPermissions("readonly", "full").deny;
    for (const tool of ["Bash", "Edit", "Write", "NotebookEdit"]) {
      expect(deny, tool).toContain(tool);
    }
    expect(deny).not.toContain("Read");
  });

  test("isolated 上限连 Read 也 deny", () => {
    expect(resolveHostPermissions("isolated", "full").deny).toContain("Read");
  });

  test("上限只能收紧:任何组合都是该上限满血模式的超集", () => {
    for (const ceiling of ["full", "readonly", "isolated"] as const) {
      const base = new Set(resolveHostPermissions(ceiling, "full").deny);
      for (const mode of ["full", "intranet", "trip"] as const) {
        const deny = new Set(resolveHostPermissions(ceiling, mode).deny);
        for (const rule of base) {
          expect(deny.has(rule), `${ceiling}/${mode} 丢了 ${rule}`).toBe(true);
        }
      }
    }
  });

  test("accountHostCeiling 的输出可直接喂给 resolveHostPermissions", () => {
    const ceiling = accountHostCeiling({ hostCeiling: "isolated" });
    expect(resolveHostPermissions(ceiling, "trip").deny).toContain("Read");
  });

  test("查不到账号时算出的是最严 deny", () => {
    const deny = resolveHostPermissions(accountHostCeiling(null), "full").deny;
    for (const tool of ["Bash", "Edit", "Write", "NotebookEdit", "Read"]) {
      expect(deny, tool).toContain(tool);
    }
  });
});

describe("接线点在源码里可查", () => {
  test("routes/misc.ts 的 POST/PATCH 有 hostCeiling 白名单", async () => {
    const source = await readFile(new URL("../../src/server/routes/misc.ts", import.meta.url), "utf8");
    expect(source).toContain("hostCeiling");
    expect(source).toMatch(/hostCeiling[\s\S]{0,160}readonly/);
    expect(source).toMatch(/hostCeiling[\s\S]{0,160}isolated/);
  });

  test("chat-stream 不再写死 full 上限", async () => {
    const source = await readFile(new URL("../../src/server/chat-stream.ts", import.meta.url), "utf8");
    expect(source).toContain("hostCeiling");
    expect(source).not.toContain('resolveHostPermissions("full", workMode)');
  });

  test("workspace-route 读不到账号时按 isolated 回落", async () => {
    const source = await readFile(new URL("../../src/server/workspace-route.ts", import.meta.url), "utf8");
    expect(source).toContain("hostCeiling");
    expect(source).toContain("isolated");
  });

  test("既有鉴权函数没被动过", async () => {
    const source = await readFile(new URL("../../src/server/auth.ts", import.meta.url), "utf8");
    expect(source).toContain("export function verifyPassword");
    expect(source).toContain("export function signSession");
    expect(source).toContain("export function deriveAccountId");
    expect(source).toContain("export function findLoginAccount");
  });
});