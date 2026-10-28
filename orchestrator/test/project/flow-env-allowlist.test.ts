import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ActiveProfile } from "../../src/project/profile.js";
import {
  buildFlowEnv, buildProfileEnv, FLOW_ENV_BASE_KEYS, flowEnvExtraAllowKeys, isFlowEnvKeyAllowed, resolveFlowEnvMode,
} from "../../src/project/profile-env-builder.js";

const profile = (credentialsEnv: Record<string, string>): ActiveProfile => ({
  id: "client-x", projectsPath: "/s/projects.json", credentialsPath: "/s/credentials.env", credentialsEnv, mcpConfigPath: "/s/mcp.json",
});
const HOST_ENV = {
  PATH: "/bin", HOME: "/home/me", USER: "me", SHELL: "/bin/zsh", TMPDIR: "/tmp", HTTPS_PROXY: "http://proxy",
  KUNPENG_STATE: "/state", KP_SCOPE_ALLOW: "src/**", KUNPENG_IN_FLOW: "1",
  AWS_SECRET_ACCESS_KEY: "aws-secret", OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-ant", NEON_API_KEY: "neon-secret",
  DATABASE_URL: "postgres://host/db", GITHUB_TOKEN: "gh-host", RANDOM_TOOL_FLAG: "1", LOGNAME: "me",
};

describe("agent 子进程环境变量白名单（作者锁定）", () => {
  it("默认 allowlist：运行必需键与 KUNPENG_/KP_ 保留，宿主密钥一个不进；无 profile 时受管键不写", () => {
    const env = buildFlowEnv({ baseEnv: HOST_ENV, allowKeys: ["PATH", "HOME"] });
    for (const key of ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "HTTPS_PROXY", "LOGNAME", "KUNPENG_STATE", "KP_SCOPE_ALLOW", "KUNPENG_IN_FLOW"]) expect(env[key]).toBe(HOST_ENV[key as keyof typeof HOST_ENV]);
    for (const key of ["AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "NEON_API_KEY", "RANDOM_TOOL_FLAG", "DATABASE_URL", "GITHUB_TOKEN"]) expect(key in env).toBe(false);
  });

  it("有 profile 时受管键来自 profile，缺的写空串；后端 authEnv 与 KUNPENG_FLOW_ENV_ALLOW 追加的键放行", () => {
    const env = buildFlowEnv({
      baseEnv: { ...HOST_ENV, KUNPENG_FLOW_ENV_ALLOW: "RANDOM_TOOL_FLAG, NEON_API_KEY" },
      allowKeys: ["PATH", "HOME", "USER", "LOGNAME", "SHELL"],
      profile: profile({ GITHUB_TOKEN: "gh-profile" }),
    });
    expect(env.GITHUB_TOKEN).toBe("gh-profile");
    expect(env.DATABASE_URL).toBe("");
    expect(env.VERCEL_TOKEN).toBe("");
    expect(env.RANDOM_TOOL_FLAG).toBe("1");
    expect(env.NEON_API_KEY).toBe("neon-secret");
    expect("AWS_SECRET_ACCESS_KEY" in env).toBe(false);
    expect("OPENAI_API_KEY" in env).toBe(false);
  });

  it("KUNPENG_FLOW_ENV_MODE=inherit 回旧行为：全量继承", () => {
    expect(resolveFlowEnvMode({})).toBe("allowlist");
    expect(resolveFlowEnvMode({ KUNPENG_FLOW_ENV_MODE: " Inherit " })).toBe("inherit");
    const env = buildFlowEnv({ baseEnv: { ...HOST_ENV, KUNPENG_FLOW_ENV_MODE: "inherit" }, profile: profile({}) });
    expect(env.AWS_SECRET_ACCESS_KEY).toBe("aws-secret");
    expect(env.OPENAI_API_KEY).toBe("sk-openai");
    expect(env.GITHUB_TOKEN).toBe("");
  });

  it("buildProfileEnv 走同一套白名单；辅助函数行为固定", () => {
    const env = buildProfileEnv(profile({ GITHUB_TOKEN: "p" }), { baseEnv: HOST_ENV });
    expect(env.GITHUB_TOKEN).toBe("p");
    expect(env.PATH).toBe("/bin");
    expect("OPENAI_API_KEY" in env).toBe(false);
    expect(FLOW_ENV_BASE_KEYS).toContain("HOME");
    expect(FLOW_ENV_BASE_KEYS).toContain("HTTPS_PROXY");
    expect(isFlowEnvKeyAllowed("KUNPENG_ANYTHING", [])).toBe(true);
    expect(isFlowEnvKeyAllowed("KP_ANYTHING", [])).toBe(true);
    expect(isFlowEnvKeyAllowed("SECRET_X", [])).toBe(false);
    expect(isFlowEnvKeyAllowed("SECRET_X", ["SECRET_X"])).toBe(true);
    expect(flowEnvExtraAllowKeys({ KUNPENG_FLOW_ENV_ALLOW: " A ,, B " })).toEqual(["A", "B"]);
    expect(flowEnvExtraAllowKeys({})).toEqual([]);
  });

  it("runner 两条 spawn 路径都整体替换 env，且总是经 buildFlowEnv", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/agent/cli-runner.ts", import.meta.url)), "utf8");
    expect(src).toContain("buildFlowEnv(");
    expect(src).toContain("allowKeys: [...adapter.authEnv, ...Object.keys(baseEnv ?? {})]");
    expect(src).toContain("replaceEnv: true");
    expect(src).not.toMatch(/return \{ env: baseEnv \};/);
  });
});