import { describe, it, expect } from "vitest";
import {
  resolveHostPermissions,
  DENY_HOST_WRITE,
  DENY_HOST_BASH,
  DENY_HOST_READ,
  type HostCeiling,
  type WorkMode,
} from "../../src/server/worker/host-permissions.js";

const CEILINGS: HostCeiling[] = ["full", "readonly", "isolated"];
const MODES: WorkMode[] = ["full", "intranet", "trip"];
const ALL_RULES = [...DENY_HOST_WRITE, ...DENY_HOST_BASH, ...DENY_HOST_READ];

describe("规则必须是裸工具名(带路径的写规则会被 Claude Code 静默忽略)", () => {
  it("三个常量都不含括号", () => {
    for (const rule of ALL_RULES) {
      expect(rule).not.toContain("(");
      expect(rule).not.toContain(")");
    }
  });

  it("写类覆盖 Edit / Write / NotebookEdit 三个工具", () => {
    expect([...DENY_HOST_WRITE].sort()).toEqual(["Edit", "NotebookEdit", "Write"]);
  });

  it("Bash 与 Read 各自是裸名", () => {
    expect(DENY_HOST_BASH).toEqual(["Bash"]);
    expect(DENY_HOST_READ).toEqual(["Read"]);
  });
});

describe("host permission resolution", () => {
  it("满血上限 + 满血模式 → deny 为空", () => {
    expect(resolveHostPermissions("full", "full").deny).toEqual([]);
  });

  it("出差模式在任意账号上限下都 deny 写类三工具", () => {
    for (const c of CEILINGS) {
      const deny = resolveHostPermissions(c, "trip").deny;
      for (const rule of DENY_HOST_WRITE) expect(deny).toContain(rule);
    }
  });

  it("出差模式在任意账号上限下都 deny Bash(子进程绕过的唯一堵法)", () => {
    for (const c of CEILINGS) {
      expect(resolveHostPermissions(c, "trip").deny).toContain("Bash");
    }
  });

  it("只读上限也必须 deny Bash 与写类", () => {
    const deny = resolveHostPermissions("readonly", "full").deny;
    expect(deny).toContain("Bash");
    for (const rule of DENY_HOST_WRITE) expect(deny).toContain(rule);
    expect(deny).not.toContain("Read");
  });

  it("隔离上限下即便满血模式也 deny Read", () => {
    expect(resolveHostPermissions("isolated", "full").deny).toContain("Read");
  });

  it("满血上限 + 出差模式:不可写不可执行,但可读", () => {
    const deny = resolveHostPermissions("full", "trip").deny;
    for (const rule of DENY_HOST_WRITE) expect(deny).toContain(rule);
    expect(deny).toContain("Bash");
    expect(deny).not.toContain("Read");
  });

  it("内网模式不额外收紧(agent 仍在主机)", () => {
    for (const c of CEILINGS) {
      expect(resolveHostPermissions(c, "intranet").deny).toEqual(
        resolveHostPermissions(c, "full").deny,
      );
    }
  });

  it("单调性:九种组合的 deny 都是同上限满血模式的超集(模式只能收紧)", () => {
    for (const c of CEILINGS) {
      const base = new Set(resolveHostPermissions(c, "full").deny);
      for (const m of MODES) {
        const deny = new Set(resolveHostPermissions(c, m).deny);
        for (const rule of base) expect(deny.has(rule)).toBe(true);
      }
    }
  });

  it("非法输入按最严档处理,绝不放宽", () => {
    const bogus = resolveHostPermissions("nope" as HostCeiling, "nope" as WorkMode).deny;
    expect(bogus).toEqual(resolveHostPermissions("isolated", "trip").deny);
    for (const rule of ALL_RULES) expect(bogus).toContain(rule);
  });

  it("结果去重且稳定排序", () => {
    const deny = resolveHostPermissions("isolated", "trip").deny;
    expect(new Set(deny).size).toBe(deny.length);
    expect([...deny].sort()).toEqual(deny);
  });

  it("同样入参多次调用结果一致(纯函数)", () => {
    expect(resolveHostPermissions("readonly", "trip")).toEqual(
      resolveHostPermissions("readonly", "trip"),
    );
  });
});