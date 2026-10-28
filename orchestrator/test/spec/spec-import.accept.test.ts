import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { preDispatchLint } from "../../src/cli-commands/devcycle.js";
import { dispatchCliCommand, listCliCommands } from "../../src/cli-commands/registry.js";
import "../../src/cli-commands/spec-tools.js";
import { lintSpecText } from "../../src/plan/spec-lint.js";
import { importExternalSpec, parseOpenSpec, parseSpecKit } from "../../src/spec/import-external.js";

const SPEC_KIT_SPEC = [
  "# Feature Specification: 登录超时提示",
  "",
  "**Feature Branch**: `012-login-timeout`",
  "",
  "**Input**: User description: \"会话过期时给出明确提示\"",
  "",
  "## User Scenarios & Testing *(mandatory)*",
  "",
  "### User Story 1 - 过期后提示重新登录 (Priority: P1)",
  "",
  "用户会话过期后操作，应看到提示。",
  "",
  "**Acceptance Scenarios**:",
  "",
  "1. **Given** 会话已过期, **When** 用户点击保存, **Then** 弹出「请重新登录」",
  "2. **Given** 会话有效, **When** 用户点击保存, **Then** 正常保存",
  "",
  "## Requirements *(mandatory)*",
  "",
  "### Functional Requirements",
  "",
  "- **FR-001**: System MUST 在会话过期时返回 401",
  "- **FR-002**: System MUST 在前端展示重新登录提示",
  "",
  "## Success Criteria *(mandatory)*",
  "",
  "- **SC-001**: 过期提示在 1 秒内出现",
  "",
].join("\n");
const SPEC_KIT_PLAN = "# Implementation Plan: 登录超时提示\n\n## Summary\n\n在 API 层统一返回 401，前端拦截器弹提示。\n\n## Technical Context\n\n**Language/Version**: TypeScript\n";
const SPEC_KIT_TASKS = "# Tasks\n\n## Phase 1: Setup\n\n- [ ] T001 Create interceptor in src/api/client.ts\n- [ ] T002 [P] [US1] Add toast in src/ui/toast.ts\n";

const OPENSPEC_PROPOSAL = "## Why\n\n会话过期时用户不知道发生了什么。\n\n## What Changes\n\n- API 统一返回 401\n- 前端提示重新登录\n";
const OPENSPEC_TASKS = "## 1. API\n\n- [ ] 1.1 统一 401 响应\n- [x] 1.2 加测试\n\n## 2. UI\n\n- [ ] 2.1 弹出提示\n";
const OPENSPEC_SPEC = "## ADDED Requirements\n\n### Requirement: 过期提示\nThe app SHALL prompt users to sign in again when the session expires.\n\n#### Scenario: 过期后保存\n- **WHEN** the session has expired and the user saves\n- **THEN** a sign-in prompt is shown\n";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-spec-import-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function specKitDir(): string {
  const dir = join(root, "specs", "012-login-timeout");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), SPEC_KIT_SPEC);
  writeFileSync(join(dir, "plan.md"), SPEC_KIT_PLAN);
  writeFileSync(join(dir, "tasks.md"), SPEC_KIT_TASKS);
  return dir;
}

function openSpecDir(): string {
  const dir = join(root, "openspec", "changes", "add-expiry-prompt");
  mkdirSync(join(dir, "specs", "auth"), { recursive: true });
  writeFileSync(join(dir, "proposal.md"), OPENSPEC_PROPOSAL);
  writeFileSync(join(dir, "tasks.md"), OPENSPEC_TASKS);
  writeFileSync(join(dir, "specs", "auth", "spec.md"), OPENSPEC_SPEC);
  return dir;
}

function h1Count(md: string): number {
  return md.split("\n").filter((line) => /^#\s/.test(line)).length;
}

function assertBlockedByPreDispatch(md: string): void {
  const codes = lintSpecText(md, root).filter((i) => i.level === "error").map((i) => i.code);
  expect(codes).toContain("scope-missing");
  expect(codes).toContain("accept-missing");
  // 即使命令行给了 --accept，缺 scope 仍被派流前闸拦下。
  expect(preDispatchLint(md, root, { acceptArgGiven: true }).blocked).toBe(true);
  expect(preDispatchLint(md, root, { acceptArgGiven: false }).blocked).toBe(true);
}

describe("spec-kit 导入（作者锁定）", () => {
  test("解析标题、FR/SC 需求、用户故事的 Given/When/Then 场景、plan 摘要与 T 编号任务", () => {
    const parts = parseSpecKit({ specMd: SPEC_KIT_SPEC, planMd: SPEC_KIT_PLAN, tasksMd: SPEC_KIT_TASKS, fallbackTitle: "x" });
    expect(parts.title).toBe("登录超时提示");
    expect(parts.requirements).toEqual(["FR-001：System MUST 在会话过期时返回 401", "FR-002：System MUST 在前端展示重新登录提示", "SC-001：过期提示在 1 秒内出现"]);
    expect(parts.scenarios).toEqual([
      "US1（P1） 过期后提示重新登录：Given 会话已过期, When 用户点击保存, Then 弹出「请重新登录」",
      "US1（P1） 过期后提示重新登录：Given 会话有效, When 用户点击保存, Then 正常保存",
    ]);
    expect(parts.context).toEqual(["在 API 层统一返回 401，前端拦截器弹提示。"]);
    expect(parts.tasks).toEqual(["T001 Create interceptor in src/api/client.ts", "T002 [P] [US1] Add toast in src/ui/toast.ts"]);
  });

  test("产出单 H1 骨架、醒目标注验收须作者亲写、无 scope/accept 块，被派流前闸拦下；不改输入目录", () => {
    const dir = specKitDir();
    const before = readdirSync(dir).map((f) => [f, statSync(join(dir, f)).mtimeMs]);
    const md = importExternalSpec("spec-kit", dir);
    expect(h1Count(md)).toBe(1);
    expect(md.split("\n")[0]).toBe("# 登录超时提示（导入自 spec-kit，待补 scope 与验收）");
    expect(md).toContain("验收必须作者亲写，导入件不可直接派流");
    expect(md).toContain("- FR-001：System MUST 在会话过期时返回 401");
    expect(md).toContain("- T001 Create interceptor in src/api/client.ts");
    expect(md.split("\n").some((line) => line.startsWith("`".repeat(3)))).toBe(false);
    assertBlockedByPreDispatch(md);
    expect(readdirSync(dir).map((f) => [f, statSync(join(dir, f)).mtimeMs])).toEqual(before);
  });
});

describe("OpenSpec 导入（作者锁定）", () => {
  test("解析 Why/What Changes 背景、Requirement 与 SHALL 句、Scenario 的 WHEN/THEN、编号任务", () => {
    const parts = parseOpenSpec({ proposalMd: OPENSPEC_PROPOSAL, tasksMd: OPENSPEC_TASKS, specMds: [OPENSPEC_SPEC], changeId: "add-expiry-prompt" });
    expect(parts.title).toBe("add-expiry-prompt");
    expect(parts.context).toEqual(["会话过期时用户不知道发生了什么。", "- API 统一返回 401", "- 前端提示重新登录"]);
    expect(parts.requirements).toEqual(["过期提示：The app SHALL prompt users to sign in again when the session expires."]);
    expect(parts.scenarios).toEqual(["过期提示 / 过期后保存：WHEN the session has expired and the user saves；THEN a sign-in prompt is shown"]);
    expect(parts.tasks).toEqual(["1.1 统一 401 响应", "1.2 加测试", "2.1 弹出提示"]);
  });

  test("目录导入同样被派流前闸拦下；缺 proposal.md / spec.md 报清楚的错", () => {
    const md = importExternalSpec("openspec", openSpecDir());
    expect(h1Count(md)).toBe(1);
    expect(md).toContain("导入自 OpenSpec");
    assertBlockedByPreDispatch(md);
    const empty = join(root, "empty");
    mkdirSync(empty);
    expect(() => importExternalSpec("openspec", empty)).toThrow(/proposal\.md/);
    expect(() => importExternalSpec("spec-kit", empty)).toThrow(/spec\.md/);
    expect(() => importExternalSpec("spec-kit", join(root, "nope"))).toThrow(/不存在/);
  });
});

describe("kunpeng spec-import 命令（作者锁定）", () => {
  test("已注册；按 --from 与 --out 写出骨架，且不覆盖已有输出文件", async () => {
    expect(listCliCommands().map((c) => c.name)).toContain("spec-import");
    const dir = openSpecDir();
    const out = join(root, "imported.md");
    const context = { repoRoot: root, kunpengHome: root, rest: ["--from", "openspec", dir], argv: [], flags: new Set<string>(), outArg: out };
    expect(await dispatchCliCommand("spec-import", context)).toBe(true);
    expect(readFileSync(out, "utf8")).toContain("导入自 OpenSpec");
  });
});