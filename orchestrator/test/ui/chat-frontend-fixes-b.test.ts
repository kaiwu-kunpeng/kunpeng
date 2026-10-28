import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clientScript } from "../../src/server/ui/client.js";
import { wsEndpointsSource } from "../helpers/ws-source.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const part03 = readFileSync(join(src, "server", "ui", "client-parts", "part03.ts"), "utf8");
const part04 = readFileSync(join(src, "server", "ui", "client-parts", "part04.ts"), "utf8");
const wsEndpoints = wsEndpointsSource();

describe("会话前端修复B", () => {
  it("渲染串仍可拼装且含新标记逻辑", () => {
    const rendered = clientScript;
    expect(rendered.length).toBeGreaterThan(100000);
    expect(rendered).toContain("归档");
  });
  it("DELETE 检查响应状态", () => {
    expect(part04).toMatch(/DELETE[\s\S]{0,400}ok/);
  });
  it("搜索行渲染 archived/sensitive 标记", () => {
    expect(part03).toMatch(/archived/);
    expect(part03).toMatch(/sensitive|🔒/);
  });
  it("resolveConversationId 对归档会话自动恢复", () => {
    expect(wsEndpoints).toMatch(/archived[\s\S]{0,300}(restore|恢复)/);
  });
});
