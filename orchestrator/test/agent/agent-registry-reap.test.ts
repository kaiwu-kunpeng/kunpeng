import { describe, it, expect } from "vitest";
import {
  parseAgentRegistryRecord,
  isRecordAlive,
  reapAgentRegistry,
} from "../../src/agent/agent-registry-reap.js";
import { formatAgentRegistryRecord } from "../../src/agent/agent-registry.js";

const base = { iso: "i", instance: "a", projectId: "p", cwd: "/c", task: "t" };
const deps = { host: "mac-1", alive: (pid: number) => pid === 4321 };

describe("parseAgentRegistryRecord", () => {
  it("解析带 pid/host 的新格式", () => {
    const line =
      "- [2026-08-22T10:00:00.000Z] main @ kunpeng ｜ /repo/wt/a ｜ 干活 ｜ pid=4321 host=mac-1\n";
    const r = parseAgentRegistryRecord(line);
    expect(r).not.toBeNull();
    expect(r?.instance).toBe("main");
    expect(r?.projectId).toBe("kunpeng");
    expect(r?.cwd).toBe("/repo/wt/a");
    expect(r?.task).toBe("干活");
    expect(r?.pid).toBe(4321);
    expect(r?.host).toBe("mac-1");
  });

  it("解析历史格式时 pid/host 为 undefined", () => {
    const line = "- [2026-08-22T10:00:00.000Z] main @ kunpeng ｜ /repo/wt/a ｜ 干活\n";
    const r = parseAgentRegistryRecord(line);
    expect(r).not.toBeNull();
    expect(r?.instance).toBe("main");
    expect(r?.pid).toBeUndefined();
    expect(r?.host).toBeUndefined();
  });

  it("不是记录行时返回 null", () => {
    expect(parseAgentRegistryRecord("随便一行文字")).toBeNull();
  });

  it("format 的输出能被 parse 往返解析回来", () => {
    const out = formatAgentRegistryRecord({
      iso: "2026-08-22T10:00:00.000Z",
      instance: "cc-1",
      projectId: "kunpeng",
      cwd: "/repo/wt/b",
      task: "写码",
      pid: 999,
      host: "mac-2",
    });
    const r = parseAgentRegistryRecord(out);
    expect(r?.pid).toBe(999);
    expect(r?.host).toBe("mac-2");
    expect(r?.task).toBe("写码");
  });

  it("不带 pid 调 format 时输出不含 pid 段", () => {
    const out = formatAgentRegistryRecord({
      iso: "2026-08-22T10:00:00.000Z",
      instance: "cc-2",
      projectId: "kunpeng",
      cwd: "/repo/wt/c",
      task: "看看",
    });
    expect(out).not.toContain("pid=");
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("isRecordAlive", () => {
  it("同主机且 pid 存活为 true", () => {
    expect(isRecordAlive({ ...base, pid: 4321, host: "mac-1" }, deps)).toBe(true);
  });

  it("同主机但 pid 已死为 false", () => {
    expect(isRecordAlive({ ...base, pid: 1, host: "mac-1" }, deps)).toBe(false);
  });

  it("异主机一律保留为 true", () => {
    expect(isRecordAlive({ ...base, pid: 1, host: "other" }, deps)).toBe(true);
  });

  it("无 pid 的历史记录为 false", () => {
    expect(isRecordAlive({ ...base }, deps)).toBe(false);
  });
});

describe("reapAgentRegistry", () => {
  it("删掉死记录与无 pid 记录，保留活记录与异主机记录", () => {
    const files: Record<string, string> = {
      "a.md": "- [i] a @ p ｜ /c ｜ t ｜ pid=4321 host=mac-1\n",
      "b.md": "- [i] b @ p ｜ /c ｜ t ｜ pid=1 host=mac-1\n",
      "c.md": "- [i] c @ p ｜ /c ｜ t\n",
      "d.md": "- [i] d @ p ｜ /c ｜ t ｜ pid=1 host=other\n",
    };
    const removed: string[] = [];
    const res = reapAgentRegistry("/dir", {
      host: "mac-1",
      alive: (pid: number) => pid === 4321,
      listFiles: () => Object.keys(files),
      readFile: (p: string) => files[p.split("/").pop() ?? ""] ?? "",
      remove: (p: string) => {
        removed.push(p.split("/").pop() ?? "");
      },
    });
    expect(res.reaped).toBe(2);
    expect(res.kept).toBe(2);
    expect(removed.sort()).toEqual(["b.md", "c.md"]);
  });

  it("解析不出记录的文件不动它", () => {
    const removed: string[] = [];
    const res = reapAgentRegistry("/dir", {
      host: "mac-1",
      alive: () => false,
      listFiles: () => ["README.md"],
      readFile: () => "这不是一条注册记录\n",
      remove: (p: string) => {
        removed.push(p);
      },
    });
    expect(res.reaped).toBe(0);
    expect(res.kept).toBe(1);
    expect(removed).toEqual([]);
  });
});