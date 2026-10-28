import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/policy-cmd.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { DEFAULTS_FILE, REQUIREMENTS_FILE, loadActionPolicy, renderActionPolicy } from "../../src/policy/policy-files.js";
import {
  BUILTIN_DEFAULTS, BUILTIN_REQUIREMENTS, OPERATION_CATEGORIES, POLICY_DECISIONS, approvalMemoryAllowed, decideOperation,
  parsePolicyMatrix, resolveActionPolicy, stricter, strictness,
} from "../../src/policy/requirements.js";

// 背景（2026-10-03 运营审计，总报告 P1-3；GitHub #1 / Codex #3#4）：动作策略只有 L0–L4 一维，shell/文件/网络/对外发布
// 不能分别 deny/ask/allow；没有「loop 不可覆盖的底线」与「spec 可覆盖的缺省」之分；「记住本次批准」没有等级边界。
// 本测试锁定：四类别 × 三态矩阵；requirements（内建 publish≥ask ∪ requirements.json，取更严）压顶、spec/defaults 只能在底线之上活动；
// 人写文件写错即抛；记住的批准只穿透 L0–L2；`kunpeng policy show` 读得出本仓生效策略。

describe("动作策略：类别 × 三态 + 底线压顶（作者锁定）", () => {
  it("常量：四类别、三态按 deny>ask>allow 排严；内建底线只有 publish:ask；内建缺省 file 放行其余问", () => {
    expect(OPERATION_CATEGORIES).toEqual(["shell", "file", "network", "publish"]);
    expect(POLICY_DECISIONS).toEqual(["deny", "ask", "allow"]);
    expect(POLICY_DECISIONS.map(strictness)).toEqual([2, 1, 0]);
    expect(stricter("ask", "allow")).toBe("ask");
    expect(stricter("deny", "ask")).toBe("deny");
    expect(BUILTIN_REQUIREMENTS).toEqual({ publish: "ask" });
    expect(BUILTIN_DEFAULTS).toEqual({ shell: "ask", file: "allow", network: "ask", publish: "ask" });
  });

  it("叠层：defaults 覆盖内建、spec 覆盖 defaults；比底线宽松的被压回并记 clamped；requirements.json 只能更严、不能放宽内建底线", () => {
    expect(resolveActionPolicy()).toEqual({ matrix: BUILTIN_DEFAULTS, sources: { shell: "builtin", file: "builtin", network: "builtin", publish: "builtin" }, clamped: [] });
    const r = resolveActionPolicy({ defaults: { shell: "allow", network: "deny" }, spec: { network: "allow", publish: "allow" } });
    expect(r.matrix).toEqual({ shell: "allow", file: "allow", network: "allow", publish: "ask" });
    expect(r.sources).toEqual({ shell: "defaults", file: "builtin", network: "spec", publish: "requirements" });
    expect(r.clamped).toEqual([{ category: "publish", requested: "allow", enforced: "ask" }]);
    const tight = resolveActionPolicy({ requirements: { network: "deny", publish: "allow" }, spec: { network: "allow", publish: "allow" } });
    expect(tight.matrix.network).toBe("deny");
    expect(tight.matrix.publish).toBe("ask");
    expect(tight.clamped.map((c) => c.category).sort()).toEqual(["network", "publish"]);
  });

  it("parsePolicyMatrix：未知类别 / 未知取值 / 非对象一律抛错并点名文件", () => {
    expect(parsePolicyMatrix({ shell: "deny" }, "x.json")).toEqual({ shell: "deny" });
    expect(() => parsePolicyMatrix({ ssh: "deny" }, "x.json")).toThrow(/x\.json.*未知操作类别「ssh」/);
    expect(() => parsePolicyMatrix({ shell: "maybe" }, "x.json")).toThrow(/x\.json.*「maybe」无效/);
    expect(() => parsePolicyMatrix(["shell"], "x.json")).toThrow(/x\.json.*须为对象/);
  });

  it("记住的批准只穿透 L0–L2：L3/L4 仍 ask；deny 不可被批准翻转；allow 直接放行", () => {
    expect(["L0", "L1", "L2", "L3", "L4"].map((l) => approvalMemoryAllowed(l as "L0"))).toEqual([true, true, true, false, false]);
    expect(approvalMemoryAllowed(undefined)).toBe(true);
    const policy = { shell: "ask", file: "allow", network: "deny", publish: "ask" } as const;
    expect(decideOperation(policy, { category: "shell", level: "L2", rememberedApproval: true }).decision).toBe("allow");
    expect(decideOperation(policy, { category: "publish", level: "L3", rememberedApproval: true })).toMatchObject({ decision: "ask" });
    expect(decideOperation(policy, { category: "publish", level: "L4", rememberedApproval: true }).reason).toContain("不吃记住的批准");
    expect(decideOperation(policy, { category: "shell", level: "L2" }).decision).toBe("ask");
    expect(decideOperation(policy, { category: "network", level: "L0", rememberedApproval: true }).decision).toBe("deny");
    expect(decideOperation(policy, { category: "file", level: "L4" }).decision).toBe("allow");
  });
});

describe("策略文件与 CLI（作者锁定）", () => {
  let repo: string;
  afterEach(() => { vi.restoreAllMocks(); rmSync(repo, { recursive: true, force: true }); });

  it("loadActionPolicy：无文件用内建；两份文件叠层并报出路径；JSON 写坏即抛并点名文件", () => {
    repo = mkdtempSync(join(tmpdir(), "kp-policy-"));
    expect(loadActionPolicy(repo)).toMatchObject({ matrix: BUILTIN_DEFAULTS, files: {} });
    mkdirSync(join(repo, ".kunpeng", "policy"), { recursive: true });
    writeFileSync(join(repo, REQUIREMENTS_FILE), JSON.stringify({ network: "deny" }));
    writeFileSync(join(repo, DEFAULTS_FILE), JSON.stringify({ shell: "allow" }));
    const loaded = loadActionPolicy(repo, { network: "allow" });
    expect(loaded.matrix).toEqual({ shell: "allow", file: "allow", network: "deny", publish: "ask" });
    expect(loaded.files).toEqual({ requirements: REQUIREMENTS_FILE, defaults: DEFAULTS_FILE });
    expect(renderActionPolicy(loaded)).toContain("⚠ network: 请求 allow 被底线压回 deny");
    writeFileSync(join(repo, DEFAULTS_FILE), "{ not json");
    expect(() => loadActionPolicy(repo)).toThrow(/defaults\.json 不是合法 JSON/);
  });

  it("kunpeng policy show --repo <path> [--json]：已注册、有用法、输出生效矩阵", async () => {
    repo = mkdtempSync(join(tmpdir(), "kp-policy-cli-"));
    mkdirSync(join(repo, ".kunpeng", "policy"), { recursive: true });
    writeFileSync(join(repo, REQUIREMENTS_FILE), JSON.stringify({ shell: "deny" }));
    const command = listCliCommands().find((c) => c.name === "policy");
    expect(command?.usage).toMatch(/^用法: kunpeng policy show/);
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await command!.run({ repoRoot: "/nowhere", rest: ["show", "--repo", repo, "--json"] } as never);
    const parsed = JSON.parse(out.join("\n")) as { matrix: Record<string, string>; sources: Record<string, string> };
    expect(parsed.matrix.shell).toBe("deny");
    expect(parsed.sources.shell).toBe("requirements");
    out.length = 0;
    await command!.run({ repoRoot: repo, rest: ["show"] } as never);
    expect(out.join("\n")).toContain("| shell | deny | requirements |");
    await command!.run({ repoRoot: repo, rest: [] } as never);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});