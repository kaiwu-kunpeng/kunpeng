import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configureScopeGuard } from "../../src/agent/cli-runner.js";
import { resolveHostPermissions } from "../../src/server/worker/host-permissions.js";
import type { AgentRequest } from "../../src/agent/runner.js";

let cwd = "";
let hookDir = "";
let hooks: { scopeGuard: string; bashShield: string };

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "kp-hostdeny-"));
  hookDir = await mkdtemp(join(tmpdir(), "kp-hooks-"));
  hooks = { scopeGuard: join(hookDir, "guard.cjs"), bashShield: join(hookDir, "shield.cjs") };
  await writeFile(hooks.scopeGuard, "// guard", "utf8");
  await writeFile(hooks.bashShield, "// shield", "utf8");
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(hookDir, { recursive: true, force: true });
});

function req(extra: Partial<AgentRequest>): AgentRequest {
  return { stage: "implement", system: "", input: "x", tools: [], cwd, ...extra };
}

async function settingsOf(): Promise<Record<string, unknown>> {
  const path = resolve(cwd, ".kunpeng", "scope-guard-settings.json");
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function settingsWritten(): boolean {
  return existsSync(resolve(cwd, ".kunpeng", "scope-guard-settings.json"));
}

describe("只有 scopeAllow:与改动前一致", () => {
  test("hooks 原样,没有 permissions 键,KP_SCOPE_ALLOW 照设", async () => {
    const out = configureScopeGuard(req({ scopeAllow: ["src/**"] }), "claude", ["-p"], undefined, hooks);
    expect(out.args).toContain("--settings");
    expect(out.env?.KP_SCOPE_ALLOW).toBe("src/**");
    const s = await settingsOf();
    expect(s.hooks).toBeDefined();
    expect(s.permissions).toBeUndefined();
  });

  test("hooks 的 matcher 没被动过", async () => {
    configureScopeGuard(req({ scopeAllow: ["a/**"] }), "claude", ["-p"], undefined, hooks);
    const s = await settingsOf() as { hooks: { PreToolUse: Array<{ matcher: string }> } };
    const matchers = s.hooks.PreToolUse.map((h) => h.matcher);
    expect(matchers).toContain("Write|Edit|MultiEdit|NotebookEdit");
    expect(matchers).toContain("Bash");
  });
});

describe("只有 hostDeny", () => {
  test("写出 permissions.deny,没有 hooks,且不设 KP_SCOPE_ALLOW", async () => {
    const out = configureScopeGuard(
      req({ hostDeny: ["Bash", "Edit", "Write", "NotebookEdit"] }), "claude", ["-p"], undefined, hooks,
    );
    expect(out.args).toContain("--settings");
    expect(out.env?.KP_SCOPE_ALLOW).toBeUndefined();
    const s = await settingsOf() as { permissions?: { deny: string[] }; hooks?: unknown };
    expect(s.permissions?.deny).toEqual(["Bash", "Edit", "NotebookEdit", "Write"]);
    expect(s.hooks).toBeUndefined();
  });

  test("hook 脚本不存在也不该 fail-closed(那两个 hook 是范围门用的)", async () => {
    const missing = { scopeGuard: join(hookDir, "没有.cjs"), bashShield: join(hookDir, "也没有.cjs") };
    expect(() => configureScopeGuard(
      req({ hostDeny: ["Bash"] }), "claude", ["-p"], undefined, missing,
    )).not.toThrow();
  });

  test("去重且稳定排序", async () => {
    configureScopeGuard(
      req({ hostDeny: ["Write", "Bash", "Write", "Edit", "Bash"] }), "claude", ["-p"], undefined, hooks,
    );
    const s = await settingsOf() as { permissions: { deny: string[] } };
    expect(s.permissions.deny).toEqual(["Bash", "Edit", "Write"]);
  });

  test("裸工具名原样保留,不被加工成路径规则", async () => {
    configureScopeGuard(req({ hostDeny: ["Bash"] }), "claude", ["-p"], undefined, hooks);
    const s = await settingsOf() as { permissions: { deny: string[] } };
    expect(s.permissions.deny).toEqual(["Bash"]);
    expect(JSON.stringify(s.permissions.deny)).not.toContain("(");
  });
});

describe("两者都有", () => {
  test("hooks 与 permissions.deny 同时出现", async () => {
    const out = configureScopeGuard(
      req({ scopeAllow: ["src/**"], hostDeny: ["Bash", "Write"] }), "claude", ["-p"], undefined, hooks,
    );
    expect(out.env?.KP_SCOPE_ALLOW).toBe("src/**");
    const s = await settingsOf() as { hooks?: unknown; permissions?: { deny: string[] } };
    expect(s.hooks).toBeDefined();
    expect(s.permissions?.deny).toEqual(["Bash", "Write"]);
  });
});

describe("什么都没有时不写文件", () => {
  test("两者都空 → 不写、不加参数", () => {
    const out = configureScopeGuard(req({}), "claude", ["-p"], undefined, hooks);
    expect(out.args).not.toContain("--settings");
    expect(settingsWritten()).toBe(false);
  });

  test("hostDeny 是空数组也算没有", () => {
    const out = configureScopeGuard(req({ hostDeny: [] }), "claude", ["-p"], undefined, hooks);
    expect(out.args).not.toContain("--settings");
    expect(settingsWritten()).toBe(false);
  });

  test("非 claude 后端一律跳过", () => {
    const out = configureScopeGuard(
      req({ hostDeny: ["Bash"], scopeAllow: ["a/**"] }), "codex", ["-p"], undefined, hooks,
    );
    expect(out.args).not.toContain("--settings");
    expect(settingsWritten()).toBe(false);
  });

  test("没有 cwd 一律跳过", () => {
    const out = configureScopeGuard(
      { stage: "implement", system: "", input: "x", tools: [], hostDeny: ["Bash"] },
      "claude", ["-p"], undefined, hooks,
    );
    expect(out.args).not.toContain("--settings");
  });
});

describe("与 resolveHostPermissions 直接对接", () => {
  test("出差模式的 deny 原样落到 settings 里", async () => {
    const deny = resolveHostPermissions("full", "trip").deny;
    configureScopeGuard(req({ hostDeny: deny }), "claude", ["-p"], undefined, hooks);
    const s = await settingsOf() as { permissions: { deny: string[] } };
    expect(s.permissions.deny).toEqual(["Bash", "Edit", "NotebookEdit", "Write"]);
  });

  test("隔离上限连 Read 也 deny", async () => {
    const deny = resolveHostPermissions("isolated", "full").deny;
    configureScopeGuard(req({ hostDeny: deny }), "claude", ["-p"], undefined, hooks);
    const s = await settingsOf() as { permissions: { deny: string[] } };
    expect(s.permissions.deny).toContain("Read");
  });

  test("满血模式没有 deny → 不写 permissions", async () => {
    const deny = resolveHostPermissions("full", "full").deny;
    expect(deny).toEqual([]);
    const out = configureScopeGuard(req({ hostDeny: deny }), "claude", ["-p"], undefined, hooks);
    expect(out.args).not.toContain("--settings");
  });
});

describe("目录不存在时照样能写", () => {
  test("自动创建 .kunpeng 目录", async () => {
    const fresh = await mkdtemp(join(tmpdir(), "kp-fresh-"));
    try {
      const out = configureScopeGuard(
        { stage: "implement", system: "", input: "x", tools: [], cwd: fresh, hostDeny: ["Bash"] },
        "claude", ["-p"], undefined, hooks,
      );
      expect(out.args).toContain("--settings");
      const s = JSON.parse(await readFile(resolve(fresh, ".kunpeng", "scope-guard-settings.json"), "utf8")) as
        { permissions: { deny: string[] } };
      expect(s.permissions.deny).toEqual(["Bash"]);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  test("已有 .kunpeng 目录时不报错", async () => {
    await mkdir(resolve(cwd, ".kunpeng"), { recursive: true });
    expect(() => configureScopeGuard(req({ hostDeny: ["Bash"] }), "claude", ["-p"], undefined, hooks)).not.toThrow();
  });
});