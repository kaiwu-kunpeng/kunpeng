import { test, expect } from "vitest";
import { renderWorkspaceSwitcher } from "../src/server/ui/shell.js";
import { httpSource } from "./helpers/http-source.js";

test("顶栏:登录态渲染当前账号与退出登录入口", () => {
  const html = renderWorkspaceSwitcher([{ id: "p1", name: "P1" }], { username: "admin" });
  expect(html).toContain('href="/api/logout"');
  expect(html).toContain("退出登录");
  expect(html).toContain("admin");
});

test("顶栏:未启用鉴权(无 username)时不渲染退出入口", () => {
  const html = renderWorkspaceSwitcher([], {});
  expect(html).not.toContain("/api/logout");
  expect(html).not.toContain("退出登录");
});

test("顶栏:用户名做 HTML 转义", () => {
  const html = renderWorkspaceSwitcher([], { username: "<img src=x onerror=1>" });
  expect(html).not.toContain("<img src=x");
});

test("接线:http.ts 启用鉴权时把 username 传进 renderShell", () => {
  const src = httpSource();
  expect(src).toMatch(/renderShell\([\s\S]{0,400}username/);
});
