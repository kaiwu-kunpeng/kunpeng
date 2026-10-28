import { afterEach, describe, expect, it, vi } from "vitest";
import { codexAdapter } from "../../src/agent/backend-adapter.js";

const saved = process.env.KUNPENG_CODEX_UNSANDBOXED;
afterEach(() => {
  if (saved === undefined) delete process.env.KUNPENG_CODEX_UNSANDBOXED;
  else process.env.KUNPENG_CODEX_UNSANDBOXED = saved;
  vi.restoreAllMocks();
});

describe("安全5 codex 一律 workspace-write 沙箱（作者锁定）", () => {
  it("默认:--sandbox workspace-write 相邻出现,危险 bypass 不出现,其余参数照旧", () => {
    delete process.env.KUNPENG_CODEX_UNSANDBOXED;
    const inv = codexAdapter.invoke({ model: "gpt-5", effort: "low" }, []);
    const i = inv.args.indexOf("--sandbox");
    expect(i).toBeGreaterThan(-1);
    expect(inv.args[i + 1]).toBe("workspace-write");
    expect(inv.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(inv.args[0]).toBe("exec");
    expect(inv.args).toContain("--json");
    expect(inv.args).toContain("--skip-git-repo-check");
    expect(inv.args.join(" ")).toContain("model_reasoning_effort=low");
    expect(inv.promptVia).toBe("stdin");
  });

  it("KUNPENG_CODEX_UNSANDBOXED=1 已废除:仍是沙箱、无 bypass,每进程只警告一次", () => {
    process.env.KUNPENG_CODEX_UNSANDBOXED = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = codexAdapter.invoke({}, []);
    const b = codexAdapter.invoke({}, []);
    for (const inv of [a, b]) {
      expect(inv.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(inv.args[inv.args.indexOf("--sandbox") + 1]).toBe("workspace-write");
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("KUNPENG_CODEX_UNSANDBOXED 已废除");
  });

  it("invokeStream 委托 invoke,同样带沙箱", () => {
    delete process.env.KUNPENG_CODEX_UNSANDBOXED;
    const inv = codexAdapter.invokeStream?.({}, []) ?? codexAdapter.invoke({}, []);
    expect(inv.args).toContain("--sandbox");
    expect(inv.args).toContain("workspace-write");
    expect(inv.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});