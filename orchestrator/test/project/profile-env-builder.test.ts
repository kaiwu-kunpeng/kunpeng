import { describe, expect, test } from "vitest";
import type { ActiveProfile } from "../../src/project/profile.js";
import {
  buildProfileEnv,
  buildProfileEnvOverlay,
  DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS,
} from "../../src/project/profile-env-builder.js";

const profile = (credentialsEnv: Record<string, string>): ActiveProfile => ({
  id: "client-x",
  projectsPath: "/state/profiles/client-x/projects.json",
  credentialsPath: "/state/profiles/client-x/credentials.env",
  credentialsEnv,
  mcpConfigPath: "/state/profiles/client-x/mcp.json",
});

describe("buildProfileEnv", () => {
  test("继承运行类 env，同时用 profile 凭证覆盖受管凭证键", () => {
    const env = buildProfileEnv(profile({ GITHUB_TOKEN: "profile-gh", NEON_DATABASE_URL: "postgres://profile/db" }), {
      baseEnv: {
        PATH: "/bin",
        HOME: "/home/me",
        HTTPS_PROXY: "http://proxy",
        GITHUB_TOKEN: "global-gh",
        VERCEL_TOKEN: "global-vercel",
      },
    });

    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/home/me");
    expect(env.HTTPS_PROXY).toBe("http://proxy");
    expect(env.GITHUB_TOKEN).toBe("profile-gh");
    expect(env.NEON_DATABASE_URL).toBe("postgres://profile/db");
  });

  test("profile 缺少的受管凭证键显式清空，避免继承全局凭证", () => {
    const env = buildProfileEnv(profile({ GITHUB_TOKEN: "profile-gh" }), {
      baseEnv: {
        GITHUB_TOKEN: "global-gh",
        VERCEL_TOKEN: "global-vercel",
        DATABASE_URL: "postgres://global/db",
      },
    });

    expect(env.GITHUB_TOKEN).toBe("profile-gh");
    expect(env.VERCEL_TOKEN).toBe("");
    expect(env.DATABASE_URL).toBe("");
  });

  test("overlay 只包含受管凭证键，供现有 spawn merge 路径使用", () => {
    const env = buildProfileEnvOverlay(profile({ VERCEL_TOKEN: "profile-vercel" }), [
      "GITHUB_TOKEN",
      "VERCEL_TOKEN",
    ]);

    expect(env).toEqual({ GITHUB_TOKEN: "", VERCEL_TOKEN: "profile-vercel" });
  });

  test("默认受管键覆盖 GitHub/Vercel/Neon 等凭证", () => {
    expect(DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS).toContain("GITHUB_TOKEN");
    expect(DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS).toContain("VERCEL_TOKEN");
    expect(DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS).toContain("NEON_DATABASE_URL");
  });
});
