import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envPreflightFrom, envPreflight, envInit } from "../../src/product/env-init.js";

describe("envPreflightFrom（纯函数）", () => {
  it("齐备则 ok", () => {
    const c = envPreflightFrom({ scripts: { dev: "x" }, devDependencies: { vitest: "^1" } }, true);
    expect(c.ok).toBe(true);
    expect(c.missing).toHaveLength(0);
  });
  it("逐项点名缺失", () => {
    const c = envPreflightFrom({ scripts: {} }, false);
    expect(c.ok).toBe(false);
    expect(c.missing.join()).toContain("dev脚本");
    expect(c.missing.join()).toContain("vitest");
    expect(c.missing.join()).toContain("node_modules");
  });
  it("无 package.json", () => {
    const c = envPreflightFrom(undefined, false);
    expect(c.missing.join()).toContain("package.json");
  });
});

describe("envPreflight / envInit（真目录+注入命令）", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-env-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("缺 vitest 与 node_modules 时按序执行安装命令", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { dev: "node x" } }));
    const ran: string[] = [];
    const r = await envInit(root, { run: async (cmd, args) => { ran.push([cmd, ...args].join(" ")); } });
    expect(r.ran.length).toBeGreaterThanOrEqual(1);
    expect(ran.join(";")).toContain("vitest");
  });
  it("环境齐备时不执行任何命令", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { dev: "x" }, devDependencies: { vitest: "^1" } }));
    mkdirSync(join(root, "node_modules"));
    const r = await envInit(root, { run: async () => { throw new Error("不应执行"); } });
    expect(r.ran).toHaveLength(0);
    expect((await envPreflight(root)).ok).toBe(true);
  });
  it("无 package.json 时不执行命令", async () => {
    const r = await envInit(root, { run: async () => { throw new Error("不应执行"); } });
    expect(r.ran).toHaveLength(0);
  });
});