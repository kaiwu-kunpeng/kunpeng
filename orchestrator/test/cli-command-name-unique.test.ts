// 验收锚:CLI 命令名不得跨文件重名 —— registerCliCommand 静默覆盖,重名 = 有个功能整条失联。
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CMD_DIR = fileURLToPath(new URL("../src/cli-commands/", import.meta.url));

function registrationsByFile(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of readdirSync(CMD_DIR)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const text = readFileSync(join(CMD_DIR, f), "utf8");
    for (const m of text.matchAll(/registerCliCommand\(\{\s*\n?\s*name:\s*"([a-z0-9-]+)"/g)) {
      const list = out.get(m[1]) ?? [];
      if (!list.includes(f)) list.push(f);
      out.set(m[1], list);
    }
  }
  return out;
}

describe("CLI 命令名唯一性", () => {
  it("扫描器本身有效:确实扫到了一批命令", () => {
    const reg = registrationsByFile();
    expect(reg.size).toBeGreaterThan(50);
    expect(reg.has("run")).toBe(true);
    expect(reg.has("merge")).toBe(true);
  });

  it("没有任何命令名出现在两个不同文件里", () => {
    const dup = [...registrationsByFile().entries()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.join(" 与 ")}`);
    expect(dup).toEqual([]);
  });

  it("bump 已注册,且不在 project-admin(那里是打印版本信息的 version)", () => {
    const reg = registrationsByFile();
    expect(reg.get("bump")).toBeTruthy();
    expect(reg.get("bump")).toEqual(["dossier-docs.ts"]);
    expect(reg.get("version")).toEqual(["project-admin.ts"]);
  });

  it("dossier-docs 不再注册 version", () => {
    const text = readFileSync(join(CMD_DIR, "dossier-docs.ts"), "utf8");
    expect(text.includes('name: "version"')).toBe(false);
    expect(text.includes('name: "bump"')).toBe(true);
  });

  it("bump 的用法提示已同步改名,不再自称 version", () => {
    const text = readFileSync(join(CMD_DIR, "dossier-docs.ts"), "utf8");
    expect(text.includes("kunpeng bump <major|minor|patch>")).toBe(true);
    expect(text.includes("kunpeng version <major|minor|patch>")).toBe(false);
  });

  it("升版本号的核心行为仍在(semver 三档 + CHANGELOG 滚动)", () => {
    const text = readFileSync(join(CMD_DIR, "dossier-docs.ts"), "utf8");
    expect(text.includes("bumpSemver")).toBe(true);
    expect(text.includes("rollUnreleased")).toBe(true);
    for (const kind of ["major", "minor", "patch"]) {
      expect(text.includes(`"${kind}"`)).toBe(true);
    }
  });
});