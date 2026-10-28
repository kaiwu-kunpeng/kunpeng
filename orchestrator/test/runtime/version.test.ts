import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kunpengVersion, versionInfo } from "../../src/runtime/version.js";
import "../../src/cli-commands/project-admin.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

describe("U1:版本号体系", () => {
  it("kunpengVersion 与 package.json 单一真源一致", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(kunpengVersion()).toBe(pkg.version);
    expect(kunpengVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("versionInfo 附带运行时信息", () => {
    const info = versionInfo();
    expect(info.version).toBe(kunpengVersion());
    expect(info.node).toBe(process.version);
    expect(info.platform).toBe(process.platform);
  });

  it("version 命令已注册进 CLI", () => {
    expect(listCliCommands().some((c) => c.name === "version")).toBe(true);
  });
});