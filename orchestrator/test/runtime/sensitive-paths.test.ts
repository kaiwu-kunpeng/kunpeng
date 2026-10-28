import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SENSITIVE_GATE_NOTE,
  SENSITIVE_PATH_RULES,
  classifySensitiveFiles,
  summarizeSensitiveLabels,
} from "../../src/runtime/sensitive-paths.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

describe("classifySensitiveFiles(作者锁定)", () => {
  it("清单里的每条规则都带非空 label 与 RegExp", () => {
    expect(SENSITIVE_PATH_RULES.length).toBeGreaterThanOrEqual(13);
    for (const rule of SENSITIVE_PATH_RULES) {
      expect(rule.label.trim().length, rule.pattern.source).toBeGreaterThan(0);
      expect(rule.pattern).toBeInstanceOf(RegExp);
    }
  });

  it.each([
    ["orchestrator/src/loop/autopilot.ts", "守门器源码"],
    ["orchestrator/src/server/auth.ts", "鉴权/授权"],
    ["orchestrator/src/server/authz.ts", "鉴权/授权"],
    ["orchestrator/src/server/auth-flow.ts", "鉴权/授权"],
    ["src/server/auth-context.ts", "鉴权/授权"],
    ["orchestrator/src/server/Auth-Change.TS", "鉴权/授权"],
    ["orchestrator/src/server/routes/gate-actions.ts", "门动作路由"],
    ["orchestrator/src/agent/account-pool.ts", "账号池"],
    ["orchestrator/src/cli-commands/accounts.ts", "账号命令"],
    ["orchestrator/src/security/prompt-shield.ts", "安全模块"],
    ["orchestrator/src/security/nested/deeper/rule.ts", "安全模块"],
    ["orchestrator/src/Security/Shield.ts", "安全模块"],
    ["orchestrator/src/server/payment-webhook.ts", "资金/隐私/凭证关键词"],
    ["apps/web/lib/Billing/invoice.tsx", "资金/隐私/凭证关键词"],
    ["orchestrator/src/pii/export.ts", "资金/隐私/凭证关键词"],
    ["orchestrator/src/util/secret-store.py", "资金/隐私/凭证关键词"],
    ["orchestrator/src/agent/CredentialVault.ts", "资金/隐私/凭证关键词"],
    [".kunpeng/auth.json", "驾驶舱登录用户表"],
    ["./.kunpeng/accounts.json", "模型账号表"],
    ["orchestrator/.kunpeng/accounts.json", "模型账号表"],
  ])("命中 %s → %s", (file, label) => {
    const out = classifySensitiveFiles([file]);
    expect(out.sensitive).toBe(true);
    expect(out.hits.map((hit) => hit.label)).toContain(label);
    expect(out.hits[0]!.file).toBe(file.replace(/^\.\//, ""));
  });

  it.each([
    "orchestrator/src/server/chat-usage.ts",
    "orchestrator/src/server/authors.ts",
    "orchestrator/src/server/author.ts",
    "orchestrator/src/server/apiinfo.ts",
    "orchestrator/src/server/happiness.ts",
    "orchestrator/src/runtime/merge-review.test.ts",
    "orchestrator/test/runtime/secret-scan.test.ts",
    "docs/specs/2026-09-07-secret-handling.md",
    "docs/billing-plan.md",
    "README.md",
    ".kunpeng/auth.json.bak",
    "orchestrator/src/security-notes.ts",
  ])("不命中 %s", (file) => {
    expect(classifySensitiveFiles([file])).toEqual({ sensitive: false, hits: [] });
  });

  it("混合列表:命中项保序、文件去重、空串忽略;空列表不敏感", () => {
    const out = classifySensitiveFiles([
      "orchestrator/src/server/chat-usage.ts",
      "orchestrator/src/server/auth.ts",
      "",
      "orchestrator/src/server/auth.ts",
      "orchestrator/src/agent/account-pool.ts",
    ]);
    expect(out.sensitive).toBe(true);
    expect(out.hits).toEqual([
      { file: "orchestrator/src/server/auth.ts", label: "鉴权/授权" },
      { file: "orchestrator/src/agent/account-pool.ts", label: "账号池" },
    ]);
    expect(summarizeSensitiveLabels(out.hits)).toBe("鉴权/授权、账号池");
    expect(classifySensitiveFiles([])).toEqual({ sensitive: false, hits: [] });
  });
});

describe("FlowTracker.markSensitive 落盘形状", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-sensitive-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("写 sensitive.hits + at,门文案缀上敏感说明但保留「合并主干」前缀,what 不动;重复打标幂等", async () => {
    let clock = 1000;
    const t = new FlowTracker(dir, () => clock);
    await t.start("f-sens", "改登录");
    await t.finish("f-sens", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f-sens → main" });

    clock = 2000;
    const hits = [
      { file: "orchestrator/src/server/auth.ts", label: "鉴权/授权" },
      { file: "orchestrator/src/agent/account-pool.ts", label: "账号池" },
    ];
    await t.markSensitive("f-sens", hits);
    const s = await t.read("f-sens");
    expect(s?.sensitive).toEqual({ hits, at: 2000 });
    expect(s?.status).toBe("verified");
    expect(s?.humanGate?.gate).toBe(`合并主干 (人工门#1) · ${SENSITIVE_GATE_NOTE}：鉴权/授权、账号池`);
    expect(s?.humanGate?.gate.includes("合并主干")).toBe(true);
    expect(s?.humanGate?.what).toBe("kp/f-sens → main");
    expect(s?.history.at(-1)).toEqual({ stage: "sensitive-marked", at: 2000 });
    expect(s?.updatedAt).toBe(2000);

    clock = 3000;
    await t.markSensitive("f-sens", hits);
    const again = await t.read("f-sens");
    expect(again?.humanGate?.gate).toBe(`合并主干 (人工门#1) · ${SENSITIVE_GATE_NOTE}：鉴权/授权、账号池`);
    expect(again?.sensitive?.at).toBe(3000);
  });

  it("没有人工门的流被打标时补一扇标准合并门(仍以「合并主干」开头,what 可解析出 base)", async () => {
    const t = new FlowTracker(dir, () => 5);
    await t.start("f-nogate", "改账号");
    await t.finish("f-nogate", "verified");
    await t.markSensitive("f-nogate", [{ file: ".kunpeng/accounts.json", label: "模型账号表" }]);
    const s = await t.read("f-nogate");
    expect(s?.humanGate?.gate.startsWith("合并主干 (人工门#1)")).toBe(true);
    expect(s?.humanGate?.gate).toContain(`${SENSITIVE_GATE_NOTE}：模型账号表`);
    expect(s?.humanGate?.what).toBe("kp/f-nogate → main");
  });

  it("不存在的流 → 静默 no-op", async () => {
    const t = new FlowTracker(dir);
    await expect(t.markSensitive("ghost", [{ file: "x", label: "y" }])).resolves.toBeUndefined();
    expect(await t.read("ghost")).toBeNull();
  });
});