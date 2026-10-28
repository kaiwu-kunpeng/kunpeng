import { test, expect } from "vitest";
import { buildChatPrompt } from "../src/server/workspace-endpoints.js";

const p = buildChatPrompt([], "你好");

test("对话系统提示:文件默认在鲲鹏本机读取,office 文档本机解析", () => {
  expect(p).toContain("默认在本机读取");
  expect(p).toContain("pptx");
  expect(p).toContain("命令行工具");
});

test("对话系统提示:localfs 降级为明确点名才用(双向锁)", () => {
  expect(p).not.toContain("绝不要用原生 Write/Read 去碰");
  expect(p).toContain("localfs_");
  expect(p).toContain("明确");
  expect(p).toContain("授权本地目录");
});

test("对话系统提示:WROTE 回执透明化规则未被误删", () => {
  expect(p).toContain("WROTE");
  expect(p).toContain("原样告诉用户");
});