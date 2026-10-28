import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, test } from "vitest";

import { emitMcpServer } from "../src/web2mcp/generator.js";
import type { ActionSpec } from "../src/web2mcp/types.js";

let tmpDir: string;

const specs: ActionSpec[] = [
  {
    id: "login form",
    kind: "form",
    title: "Login",
    target: { url: "https://example.test/login", method: "POST" },
    params: [
      { name: "email", type: "string", required: true, in: "form" },
      { name: "remember", type: "boolean", required: false, in: "form" },
    ],
    needsAuth: false,
  },
  {
    id: "post-api-items",
    kind: "network",
    title: "POST /api/items",
    target: { url: "https://example.test/api/items?draft=true", method: "POST" },
    params: [
      { name: "draft", type: "boolean", required: false, in: "query" },
      { name: "name", type: "string", required: true, in: "body" },
    ],
    needsAuth: true,
  },
];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "web2mcp-generator-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test("emitMcpServer writes a standalone MCP project and returns metadata", async () => {
  const result = await emitMcpServer(specs, tmpDir);

  expect(result).toEqual({ outDir: tmpDir, tools: 2, specs });
  await expect(readFile(path.join(tmpDir, "server.ts"), "utf8")).resolves.toContain(
    'name: "web2mcp-generated"',
  );
  await expect(readFile(path.join(tmpDir, "tsconfig.json"), "utf8")).resolves.toContain(
    '"module": "NodeNext"',
  );
  await expect(readFile(path.join(tmpDir, "README.md"), "utf8")).resolves.toContain(
    "web2mcp-login",
  );
});

test("server.ts registers one tool for each action spec", async () => {
  await emitMcpServer(specs, tmpDir);
  const serverTs = await readFile(path.join(tmpDir, "server.ts"), "utf8");

  expect(serverTs).toContain('"toolName": "login_form"');
  expect(serverTs).toContain('"toolName": "post-api-items"');
  expect(serverTs).toContain("ListToolsRequestSchema");
  expect(serverTs).toContain("CallToolRequestSchema");
  expect(serverTs).toContain("runFormAction");
  expect(serverTs).toContain("runNetworkAction");
});

test("package.json declares generated server runtime dependencies", async () => {
  await emitMcpServer(specs, tmpDir);
  const pkg = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };

  expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toBeTruthy();
  expect(pkg.dependencies.playwright).toBeTruthy();
});

test("actions.json preserves the original action specs", async () => {
  await emitMcpServer(specs, tmpDir);
  const actions = JSON.parse(await readFile(path.join(tmpDir, "actions.json"), "utf8")) as ActionSpec[];

  expect(actions).toEqual(specs);
});

test("throws a clear error when there are no action specs", async () => {
  await expect(emitMcpServer([], tmpDir)).rejects.toThrow(
    "web2mcp generator requires at least one ActionSpec",
  );
});

// 防回归（对抗审查抓到的两个 HIGH）：多 spec 时生成物必须可编译。
test("生成物可编译保障：specs 用 ': ActionSpec[]' 注解(非 satisfies) + devDeps 含 @types/node", async () => {
  await emitMcpServer(specs, tmpDir); // specs 含 2 个不同 param 形状 → 是触发原 TS2345 的场景
  const server = await readFile(path.join(tmpDir, "server.ts"), "utf8");
  // satisfies 会让各 spec 字面量类型并集出 `key?: undefined`，与 Record 索引签名不兼容 → TS2345
  expect(server).toContain("const specs: ActionSpec[] =");
  expect(server).not.toContain("satisfies ActionSpec[]");
  // 生成的 server 用 node:fs/promises + process → 必须带 @types/node 否则开箱 tsc 挂
  const pkg = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf8"));
  expect(pkg.devDependencies).toHaveProperty("@types/node");
});
