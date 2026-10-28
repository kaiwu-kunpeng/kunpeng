import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import "../../src/server/routes/version.js";
import "../../src/cli-commands/project-admin.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { downloadUpdate } from "../../src/runtime/update-channel.js";

describe("U2b:升级通道接线", () => {
  it("注册了 GET /api/version", () => {
    expect(listModularRoutes().some((r) => r.method === "GET" && r.path === "/api/version")).toBe(true);
  });

  it("upgrade 与 version 命令都已注册", () => {
    const names = listCliCommands().map((c) => c.name);
    expect(names.includes("upgrade")).toBe(true);
    expect(names.includes("version")).toBe(true);
  });

  it("downloadUpdate 拒绝路径穿越版本号", async () => {
    await expect(downloadUpdate({ version: "../escape", url: "https://x/a.tgz" }, tmpdir())).rejects.toThrow();
    await expect(downloadUpdate({ version: "v1/../..", url: "https://x/a.tgz" }, tmpdir())).rejects.toThrow();
  });
});