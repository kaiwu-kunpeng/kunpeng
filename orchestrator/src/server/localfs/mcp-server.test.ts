import { describe, expect, test } from "vitest";
import { safeRelativePath, toolToOp, LOCALFS_TOOLS } from "./mcp-server.js";

describe("localfs MCP", () => {
  test("暴露 6 个工具", () => {
    expect([...LOCALFS_TOOLS].sort()).toEqual([
      "localfs_delete",
      "localfs_list",
      "localfs_mkdir",
      "localfs_read",
      "localfs_stat",
      "localfs_write",
    ]);
  });

  test("write 工具映射到 write op 带 content", () => {
    expect(toolToOp("localfs_write", { path: "a.txt", content: "x" })).toEqual({
      kind: "write",
      path: "a.txt",
      content: "x",
    });
  });

  test("read 工具映射到 read op", () => {
    expect(toolToOp("localfs_read", { path: "a.txt" })).toEqual({
      kind: "read",
      path: "a.txt",
    });
  });

  test("路径越权（含 ..）被拒", () => {
    expect(() => toolToOp("localfs_read", { path: "../etc/passwd" })).toThrow();
  });

  test("根路径写法统一归一化为空字符串", () => {
    expect(safeRelativePath("")).toBe("");
    expect(safeRelativePath("/")).toBe("");
    expect(safeRelativePath(".")).toBe("");
    expect(safeRelativePath("./")).toBe("");
  });

  test("普通相对路径保留且越权路径继续被拒", () => {
    expect(safeRelativePath("a/b.txt")).toBe("a/b.txt");
    expect(() => safeRelativePath("../x")).toThrow();
    expect(() => safeRelativePath("/etc/passwd")).toThrow();
  });

  test("list 工具透传 recursive 布尔参数", () => {
    expect(toolToOp("localfs_list", { path: "", recursive: true })).toMatchObject({
      kind: "list",
      path: "",
      recursive: true,
    });
  });

  test("list 工具未传 recursive 时不补默认值", () => {
    const op = toolToOp("localfs_list", { path: "sub" });
    expect(op).toEqual({ kind: "list", path: "sub" });
    expect(op.recursive).toBeUndefined();
  });
});
