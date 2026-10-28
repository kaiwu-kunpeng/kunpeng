import { describe, expect, it, vi } from "vitest";
import { killProcessTree } from "../../src/agent/cli-stream.js";
import { handleUnhandledRejection, handleUncaughtException } from "../../src/runtime/process-guards.js";

describe("S1 进程韧性(作者验收)", () => {
  it("killProcessTree:先按负 pid 杀整组", () => {
    const calls: Array<[number, string]> = [];
    killProcessTree(4242, "SIGTERM", { kill: (p, s) => { calls.push([p, s as string]); } });
    expect(calls[0][0]).toBe(-4242);
    expect(calls[0][1]).toBe("SIGTERM");
  });

  it("killProcessTree:组杀失败回退直接杀,不上抛", () => {
    const calls: Array<number> = [];
    expect(() => killProcessTree(99, "SIGKILL", {
      kill: (p) => { calls.push(p); if (p < 0) throw new Error("no such group"); },
    })).not.toThrow();
    expect(calls).toEqual([-99, 99]);
  });

  it("handleUnhandledRejection:记日志但不退出", () => {
    const log = vi.fn();
    const exit = vi.fn();
    handleUnhandledRejection(new Error("boom"), log);
    expect(log).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("handleUncaughtException:记日志且以 1 退出", () => {
    const log = vi.fn();
    const exit = vi.fn();
    handleUncaughtException(new Error("fatal"), log, exit);
    expect(log).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});