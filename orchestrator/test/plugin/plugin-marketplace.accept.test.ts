import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/plugin.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import {
  MARKETPLACE_FILE, PLUGIN_DISTRIBUTIONS, diagnosePlugins, fileSha256, loadMarketplace, parseMarketplace, renderDoctor, type Marketplace,
} from "../../src/plugin/marketplace.js";
import { upsertPlugin } from "../../src/plugin/store.js";

// 背景（2026-10-03 插件审计 A1 S2 / K1，总报告 P1-7 第二步）：没有市场清单，装什么全靠口口相传；没有 sha 钉版与 distribution；
// 没有对账——required 插件漏装、包被改过、版本漂移全靠人记。本测试锁定：marketplace.json 形状 fail-closed（kpkg 必钉 sha256、
// git 来源须钉 commit〔P1-7c〕、name 唯一）；doctor 纯判定六类问题；`kunpeng plugin market / doctor` 接上，有错退出码 1。

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("marketplace.json 解析（作者锁定）", () => {
  it("合法条目：local / kpkg(sha 钉) / pin / distribution 缺省 on；坏形状逐条点名", () => {
    expect(PLUGIN_DISTRIBUTIONS).toEqual(["off", "on", "required"]);
    const m = parseMarketplace(JSON.stringify({ entries: [
      { name: "a-kit", source: { kind: "local", path: "/p/a" } },
      { name: "b-kit", source: { kind: "kpkg", path: "/p/b.kpkg", sha256: "A".repeat(64) }, distribution: "required", pin: "1.2.0", description: "b" },
    ] }));
    expect(m.entries).toEqual([
      { name: "a-kit", source: { kind: "local", path: "/p/a" }, distribution: "on" },
      { name: "b-kit", source: { kind: "kpkg", path: "/p/b.kpkg", sha256: "a".repeat(64) }, distribution: "required", pin: "1.2.0", description: "b" },
    ]);
    const bad = (entries: unknown, re: RegExp) => expect(() => parseMarketplace(JSON.stringify({ entries }))).toThrow(re);
    expect(() => parseMarketplace("[]")).toThrow(/entries/);
    bad([{ name: "Bad", source: { kind: "local", path: "/x" } }], /entries\[0\].*name/);
    bad([{ name: "a", source: { kind: "local", path: "/x" } }, { name: "a", source: { kind: "local", path: "/y" } }], /entries\[1\].*重复「a」/);
    bad([{ name: "a", source: { kind: "kpkg", path: "/x.kpkg" } }], /kpkg 来源必须钉 sha256/);
    bad([{ name: "a", source: { kind: "git", url: "https://x/y.git" } }], /git 来源必须钉 commit/);
    bad([{ name: "a", source: { kind: "local", path: "/x" }, distribution: "maybe" }], /distribution 须为 off\/on\/required/);
    bad([{ name: "a", source: { kind: "local", path: "/x" }, pin: "1.0" }], /pin 须为 semver/);
    const root = tmp("kp-market-");
    expect(loadMarketplace(root)).toEqual({ entries: [] });
    writeFileSync(join(root, MARKETPLACE_FILE), JSON.stringify({ entries: [{ name: "a-kit", source: { kind: "local", path: "/p/a" } }] }));
    expect(loadMarketplace(root).entries).toHaveLength(1);
  });
});

describe("doctor 纯判定（作者锁定）", () => {
  const market: Marketplace = { entries: [
    { name: "req-kit", source: { kind: "local", path: "/p/req" }, distribution: "required" },
    { name: "pin-kit", source: { kind: "kpkg", path: "/p/pin.kpkg", sha256: sha("good") }, distribution: "on", pin: "2.0.0" },
    { name: "off-kit", source: { kind: "local", path: "/p/off" }, distribution: "off" },
    { name: "fine-kit", source: { kind: "local", path: "/p/fine" }, distribution: "on" },
  ] };
  const installed = [
    { name: "pin-kit", version: "1.9.0", dir: "/i/pin", enabled: true },
    { name: "off-kit", version: "1.0.0", dir: "/i/off", enabled: true },
    { name: "wild-kit", version: "0.1.0", dir: "/i/wild", enabled: false },
    { name: "fine-kit", version: "1.0.0", dir: "/i/gone", enabled: true },
  ];
  it("required 缺装、sha 不符、pin 漂移、off 仍装、目录丢失、野装 各一条；全对时为空", () => {
    const findings = diagnosePlugins({ marketplace: market, installed, dirExists: (d) => d !== "/i/gone", kpkgSha256: () => sha("tampered") });
    expect(findings.map((f) => [f.severity, f.plugin, f.issue.split("：")[0]])).toEqual([
      ["error", "req-kit", "required 但未安装"],
      ["warn", "pin-kit", "版本漂移"],
      ["error", "pin-kit", "kpkg sha256 与市场钉的不符（包被改过或清单过期）"],
      ["warn", "off-kit", "市场已下架（off）但本机仍装着"],
      ["warn", "wild-kit", "不在市场清单里（野装）"],
      ["error", "fine-kit", "已登记但目录不在"],
    ]);
    expect(findings.find((f) => f.plugin === "req-kit")!.fix).toBe("kunpeng plugin add /p/req --enable");
    const disabled = diagnosePlugins({ marketplace: { entries: [market.entries[0]!] }, installed: [{ name: "req-kit", version: "1.0.0", dir: "/i/req", enabled: false }], dirExists: () => true });
    expect(disabled).toEqual([{ severity: "error", plugin: "req-kit", issue: "required 但未启用", fix: "kunpeng plugin enable req-kit" }]);
    const clean = diagnosePlugins({ marketplace: { entries: [market.entries[1]!] }, installed: [{ name: "pin-kit", version: "2.0.0", dir: "/i/pin", enabled: true }], dirExists: () => true, kpkgSha256: () => sha("good") });
    expect(clean).toEqual([]);
    expect(diagnosePlugins({ marketplace: { entries: [] }, installed: [installed[2]!], dirExists: () => true })).toEqual([]);
    expect(renderDoctor(findings, 4, 4)).toContain("市场 4 条 · 已装 4 个 · ✗ 3 错 / 3 警");
    expect(renderDoctor([], 1, 1)).toContain("✓ 无问题");
    const f = tmp("kp-sha-"); writeFileSync(join(f, "x.kpkg"), "good");
    expect(fileSha256(join(f, "x.kpkg"))).toBe(sha("good"));
    expect(fileSha256(join(f, "nope.kpkg"))).toBeUndefined();
  });
});

describe("kunpeng plugin market / doctor（作者锁定）", () => {
  it("market 列出条目；doctor 对账并在有错时 exitCode=1；空市场时 doctor 只报野装为无（不扰民）", async () => {
    const root = tmp("kp-plugins-root-"); mkdirSync(root, { recursive: true });
    const savedState = process.env.KUNPENG_STATE; process.env.KUNPENG_STATE = root.replace(/\/plugins$/, "");
    const pluginsRootDir = join(process.env.KUNPENG_STATE, "plugins"); mkdirSync(pluginsRootDir, { recursive: true });
    const out: string[] = []; const tables: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
    vi.spyOn(console, "table").mockImplementation((rows: unknown) => { tables.push(rows); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const command = listCliCommands().find((c) => c.name === "plugin")!;
    const ctx = (rest: string[]) => ({ repoRoot: root, rest, argv: ["plugin", ...rest] }) as never;
    try {
      process.exitCode = 0;
      await command.run(ctx(["market"]));
      expect(out.join("\n")).toContain("市场为空");
      await command.run(ctx(["doctor"]));
      expect(out.join("\n")).toContain("市场 0 条 · 已装 0 个 · ✓ 无问题");
      expect(process.exitCode).toBe(0);
      writeFileSync(join(pluginsRootDir, MARKETPLACE_FILE), JSON.stringify({ entries: [{ name: "req-kit", source: { kind: "local", path: "/p/req" }, distribution: "required", pin: "1.0.0" }] }));
      await upsertPlugin(pluginsRootDir, { name: "wild-kit", version: "0.1.0", dir: root, enabled: true });
      out.length = 0;
      await command.run(ctx(["market"]));
      expect(tables[0]).toEqual([{ name: "req-kit", distribution: "required", source: "local:/p/req", pin: "1.0.0", 说明: "" }]);
      await command.run(ctx(["doctor"]));
      expect(out.join("\n")).toContain("错误 req-kit: required 但未安装");
      expect(out.join("\n")).toContain("警告 wild-kit: 不在市场清单里");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      if (savedState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = savedState;
    }
  });
});