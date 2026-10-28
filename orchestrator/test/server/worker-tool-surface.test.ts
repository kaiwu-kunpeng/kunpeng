import { describe, expect, test } from "vitest";
import {
  WORKER_TOOLS,
  toolToWorkerOp,
} from "../../src/server/worker/tool-surface.js";

describe("worker 工具面 ws_*", () => {
  test("恰好暴露七个工具", () => {
    expect([...WORKER_TOOLS].sort()).toEqual([
      "ws_delete",
      "ws_exec",
      "ws_list",
      "ws_mkdir",
      "ws_read",
      "ws_stat",
      "ws_write",
    ]);
  });

  test("六个文件工具映射到正确的 kind", () => {
    expect(toolToWorkerOp("ws_read", { path: "a.txt" })).toEqual({ op: "fs", kind: "read", path: "a.txt" });
    expect(toolToWorkerOp("ws_stat", { path: "a.txt" })).toEqual({ op: "fs", kind: "stat", path: "a.txt" });
    expect(toolToWorkerOp("ws_delete", { path: "a.txt" })).toEqual({ op: "fs", kind: "delete", path: "a.txt" });
    expect(toolToWorkerOp("ws_mkdir", { path: "d" })).toEqual({ op: "fs", kind: "mkdir", path: "d" });
    expect(toolToWorkerOp("ws_list", { path: "d" })).toEqual({ op: "fs", kind: "list", path: "d" });
  });

  test("ws_write 带 content", () => {
    expect(toolToWorkerOp("ws_write", { path: "a.txt", content: "hello" })).toEqual({
      op: "fs",
      kind: "write",
      path: "a.txt",
      content: "hello",
    });
  });

  test("ws_write 的 content 非字符串或缺失时抛错", () => {
    expect(() => toolToWorkerOp("ws_write", { path: "a.txt" })).toThrow();
    expect(() => toolToWorkerOp("ws_write", { path: "a.txt", content: 42 })).toThrow();
    expect(() => toolToWorkerOp("ws_write", { path: "a.txt", content: null })).toThrow();
  });

  test("ws_list 的 recursive 非布尔时抛错", () => {
    expect(toolToWorkerOp("ws_list", { path: "d", recursive: true })).toEqual({
      op: "fs",
      kind: "list",
      path: "d",
      recursive: true,
    });
    expect(() => toolToWorkerOp("ws_list", { path: "d", recursive: "yes" })).toThrow();
  });

  test("ws_exec 映射 command", () => {
    expect(toolToWorkerOp("ws_exec", { command: "npm test" })).toEqual({
      op: "exec",
      command: "npm test",
    });
  });

  test("ws_exec 带 timeoutMs", () => {
    expect(toolToWorkerOp("ws_exec", { command: "npm test", timeoutMs: 5000 })).toEqual({
      op: "exec",
      command: "npm test",
      timeoutMs: 5000,
    });
  });

  test("ws_exec 的 command 必须是非空字符串", () => {
    expect(() => toolToWorkerOp("ws_exec", {})).toThrow();
    expect(() => toolToWorkerOp("ws_exec", { command: "" })).toThrow();
    expect(() => toolToWorkerOp("ws_exec", { command: "   " })).toThrow();
    expect(() => toolToWorkerOp("ws_exec", { command: 123 })).toThrow();
  });

  test("ws_exec 的 timeoutMs 必须是正整数", () => {
    expect(() => toolToWorkerOp("ws_exec", { command: "x", timeoutMs: 0 })).toThrow();
    expect(() => toolToWorkerOp("ws_exec", { command: "x", timeoutMs: -1 })).toThrow();
    expect(() => toolToWorkerOp("ws_exec", { command: "x", timeoutMs: 1.5 })).toThrow();
    expect(() => toolToWorkerOp("ws_exec", { command: "x", timeoutMs: "5000" })).toThrow();
  });

  test("路径越权被拒:.. 穿越", () => {
    expect(() => toolToWorkerOp("ws_read", { path: "../etc/passwd" })).toThrow();
    expect(() => toolToWorkerOp("ws_read", { path: "a/../../b" })).toThrow();
    expect(() => toolToWorkerOp("ws_write", { path: "../x", content: "y" })).toThrow();
  });

  test("路径越权被拒:绝对路径", () => {
    expect(() => toolToWorkerOp("ws_read", { path: "/etc/passwd" })).toThrow();
    expect(() => toolToWorkerOp("ws_mkdir", { path: "/tmp/evil" })).toThrow();
  });

  test("路径越权被拒:Windows 绝对路径", () => {
    expect(() => toolToWorkerOp("ws_read", { path: "C:\\Windows\\system32" })).toThrow();
  });

  test("未知工具名抛错且信息里含该名字", () => {
    expect(() => toolToWorkerOp("ws_bogus", { path: "a" })).toThrow(/ws_bogus/);
    expect(() => toolToWorkerOp("localfs_read", { path: "a" })).toThrow();
  });

  test("同样入参多次调用结果一致(纯函数)", () => {
    expect(toolToWorkerOp("ws_read", { path: "a.txt" })).toEqual(
      toolToWorkerOp("ws_read", { path: "a.txt" }),
    );
  });
});