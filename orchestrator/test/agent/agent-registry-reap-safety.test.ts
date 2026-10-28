import { describe, it, expect } from "vitest";
import { reapAgentRegistry } from "../../src/agent/agent-registry-reap.js";

const DEAD = "- [i] x @ p ｜ /c ｜ t ｜ pid=1 host=mac-1\n";
const ALIVE = "- [i] y @ p ｜ /c ｜ t ｜ pid=4321 host=mac-1\n";

describe("reapAgentRegistry 的异常安全", () => {
  it("readFile 抛错时不抛出，该文件计入 kept", () => {
    const res = reapAgentRegistry("/dir", {
      host: "mac-1",
      alive: () => false,
      listFiles: () => ["bad.md"],
      readFile: () => {
        throw new Error("EISDIR");
      },
      remove: () => undefined,
    });
    expect(res).toEqual({ kept: 1, reaped: 0 });
  });

  it("remove 抛错时不抛出，该文件计入 kept 而非 reaped", () => {
    const res = reapAgentRegistry("/dir", {
      host: "mac-1",
      alive: () => false,
      listFiles: () => ["dead.md"],
      readFile: () => DEAD,
      remove: () => {
        throw new Error("EPERM");
      },
    });
    expect(res).toEqual({ kept: 1, reaped: 0 });
  });

  it("listFiles 抛错时返回全零且不抛出", () => {
    const res = reapAgentRegistry("/dir", {
      host: "mac-1",
      alive: () => false,
      listFiles: () => {
        throw new Error("ENOENT");
      },
      readFile: () => "",
      remove: () => undefined,
    });
    expect(res).toEqual({ kept: 0, reaped: 0 });
  });

  it("一个文件抛错不中断整批，其余照常处理", () => {
    const removed: string[] = [];
    const res = reapAgentRegistry("/dir", {
      host: "mac-1",
      alive: (pid: number) => pid === 4321,
      listFiles: () => ["bad.md", "dead.md", "alive.md"],
      readFile: (p: string) => {
        if (p.endsWith("bad.md")) throw new Error("EISDIR");
        return p.endsWith("dead.md") ? DEAD : ALIVE;
      },
      remove: (p: string) => {
        removed.push(p.split("/").pop() ?? "");
      },
    });
    expect(res.reaped).toBe(1);
    expect(res.kept).toBe(2);
    expect(removed).toEqual(["dead.md"]);
  });
});