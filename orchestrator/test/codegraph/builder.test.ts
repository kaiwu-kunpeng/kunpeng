import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraphFromDir } from "../../src/codegraph/builder.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cg-"));
  writeFileSync(join(dir, "a.ts"), `export function login() { validate(); }\nfunction validate() {}\n`);
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "b.ts"), `export class OrderService {}\n`);
  // 应被跳过的噪声
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "junk.ts"), `function shouldBeSkipped() {}\n`);
  writeFileSync(join(dir, "types.d.ts"), `export type X = number;\n`);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("indexes ts files across nested dirs into one graph", () => {
  const g = buildGraphFromDir(dir);
  expect(g.search("login").length).toBe(1);
  expect(g.search("OrderService").length).toBe(1);
  // 跨文件? 此例 login/validate 同文件,断言调用边在
  expect(g.callees("login").map((n) => n.name)).toContain("validate");
});

test("skips node_modules and .d.ts", () => {
  const g = buildGraphFromDir(dir);
  expect(g.search("shouldBeSkipped").length).toBe(0);
  expect(g.search("X").length).toBe(0);
});