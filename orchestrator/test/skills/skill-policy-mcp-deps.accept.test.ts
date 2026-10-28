import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseSkillFrontmatter } from "../../src/skills/skill-md.js";
import { allowsImplicitInvocation, type SkillEntry } from "../../src/skills/registry.js";
import { chatMcpAllowlist, chatMcpNames, skillDeclaredMcpNames } from "../../src/server/localfs/chat-wiring.js";

const md = (body: string): string => ["---", "name: demo", "description: d", body, "---", "", "# demo"].join("\n");

const entry = (over: Partial<SkillEntry>): SkillEntry => ({
  id: "x",
  name: "x",
  description: "d",
  origin: "authored",
  dir: "/tmp/x",
  registeredAt: "2026-07-30T00:00:00.000Z",
  ...over,
});

describe("技能声明:是否允许隐式调用 + 所需 MCP", () => {
  test("产物落盘:接线文件存在", () => {
    expect(existsSync(join(process.cwd(), "src/server/localfs/chat-wiring.ts"))).toBe(true);
  });

  test("allow-implicit-invocation: false 被解析", () => {
    expect(parseSkillFrontmatter(md("allow-implicit-invocation: false"))["allow-implicit-invocation"]).toBe(false);
  });

  test("缺省即视为允许隐式调用", () => {
    expect(allowsImplicitInvocation(entry({}))).toBe(true);
    expect(allowsImplicitInvocation(entry({ implicitInvocation: false }))).toBe(false);
    expect(allowsImplicitInvocation(entry({ implicitInvocation: true }))).toBe(true);
  });

  test("requires-mcp:YAML 列表与逗号写法结果一致", () => {
    const yaml = parseSkillFrontmatter(md("requires-mcp:\n- context7\n- vercel"))["requires-mcp"];
    const inline = parseSkillFrontmatter(md("requires-mcp: context7, vercel"))["requires-mcp"];
    expect(yaml).toEqual(["context7", "vercel"]);
    expect(inline).toEqual(["context7", "vercel"]);
  });

  test("只收启用技能声明的 MCP,去重保序", () => {
    const entries = [
      entry({ id: "a", requiresMcp: ["context7", "vercel"] }),
      entry({ id: "b", requiresMcp: ["context7", "cf-docs"] }),
      entry({ id: "c", enabled: false, requiresMcp: ["should-not-appear"] }),
    ];
    expect(skillDeclaredMcpNames(entries)).toEqual(["context7", "vercel", "cf-docs"]);
  });

  test("环境变量白名单在前,技能声明补在后", () => {
    const env = { KP_CHAT_MCP: "xcrawl,context7" } as unknown as NodeJS.ProcessEnv;
    const entries = [entry({ id: "a", requiresMcp: ["context7", "cf-docs"] })];
    expect(chatMcpAllowlist(env)).toEqual(["xcrawl", "context7"]);
    expect(chatMcpNames(env, entries)).toEqual(["xcrawl", "context7", "cf-docs"]);
  });

  test("无技能声明时与旧行为一致", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(chatMcpNames(env, [])).toEqual(chatMcpAllowlist(env));
  });
});