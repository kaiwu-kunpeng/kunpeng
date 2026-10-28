import { describe, it, expect } from "vitest";
import { authorizeWorkspaceInProfile } from "../../src/server/pty-endpoint.js";
import { currentProfileId } from "../../src/server/auth-context.js";

describe("authorizeWorkspaceInProfile", () => {
  it("resolveCwd 在会话 profile 上下文内执行", async () => {
    let seen: string | undefined = "unset";
    const cwd = await authorizeWorkspaceInProfile(
      { profileId: "alice", username: "a" },
      "w1",
      async () => { seen = currentProfileId(); return "/repo/alice"; },
    );
    expect(seen).toBe("alice");
    expect(cwd).toBe("/repo/alice");
  });

  it("跨 profile 工作区被注册表拒解析 → 原样抛错拒连", async () => {
    const resolveCwd = async () => {
      if (currentProfileId() !== "owner") throw new Error("未知工作区 w1");
      return "/repo/owner";
    };
    await expect(
      authorizeWorkspaceInProfile({ profileId: "attacker" }, "w1", resolveCwd),
    ).rejects.toThrow("未知工作区");
  });

  it("无 profile（单账号）→ currentProfileId undefined，正常返回", async () => {
    let seen: string | undefined = "unset";
    const cwd = await authorizeWorkspaceInProfile(
      {},
      "w1",
      async () => { seen = currentProfileId(); return "/repo"; },
    );
    expect(seen).toBeUndefined();
    expect(cwd).toBe("/repo");
  });
});