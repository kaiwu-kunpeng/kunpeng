import { describe, it, expect } from "vitest";
import "../../src/cli-commands/board-serve.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { cliJsPath } from "../../src/cli-commands/shared.js";

describe("看板/服务命令组析出到 CLI 注册表", () => {
  it("注册了 board/task/board-watch/serve/pre-review/web2mcp/web2mcp-login/scout", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["board", "task", "board-watch", "serve", "pre-review", "web2mcp", "web2mcp-login", "scout"]) {
      expect(names).toContain(name);
    }
  });

  it("cliJsPath 指向 cli-commands 上一级的 cli.js(dist 布局等价于旧 import.meta.url)", () => {
    expect(cliJsPath().endsWith("cli.js")).toBe(true);
    expect(cliJsPath().includes("cli-commands")).toBe(false);
  });
});