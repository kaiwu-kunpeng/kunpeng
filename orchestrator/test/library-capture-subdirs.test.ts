import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLibraryIndex, captureDirsUnder } from "../src/library/scan.js";

const roots: string[] = [];

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeCapture(dir: string, id: string, title: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify({
      id,
      source: { kind: "file", ref: `${id}.md` },
      kind: "doc",
      raw: `正文 ${title}`,
      title,
      tags: [],
      createdAt: 1700000000000,
    }),
    "utf8",
  );
}

describe("captureDirsUnder", () => {
  it("captures 目录不存在时不抛错,也不返回它", async () => {
    const state = temp("kp-lib-empty-");
    const dirs = await captureDirsUnder(state);
    expect(dirs).toEqual([]);
  });

  it("列出本层 + 直接子目录(名称升序) + shared/knowledge,顺序固定", async () => {
    const state = temp("kp-lib-dirs-");
    mkdirSync(join(state, "captures", "bbb"), { recursive: true });
    mkdirSync(join(state, "captures", "aaa"), { recursive: true });
    mkdirSync(join(state, "shared", "knowledge"), { recursive: true });
    const dirs = await captureDirsUnder(state);
    expect(dirs).toEqual([
      join(state, "captures"),
      join(state, "captures", "aaa"),
      join(state, "captures", "bbb"),
      join(state, "shared", "knowledge"),
    ]);
  });
});

describe("资料库索引扫得到子目录里的 capture", () => {
  it("按项目分子目录里的 capture 进得了索引(修复前为 0 条)", async () => {
    const state = temp("kp-lib-sub-");
    writeCapture(join(state, "captures", "proj-abc123"), "cap-in-subdir", "子目录里的收录");
    const { entries } = await buildLibraryIndex({ stateDir: state });
    const titles = entries.map((e) => e.title);
    expect(titles).toContain("子目录里的收录");
    expect(entries.filter((e) => e.type === "capture")).toHaveLength(1);
  });

  it("本层 + 子目录 + shared 都扫,同 id 副本只出一条", async () => {
    const state = temp("kp-lib-dedup-");
    writeCapture(join(state, "captures"), "cap-flat", "平铺的收录");
    writeCapture(join(state, "captures", "proj-abc123"), "cap-dup", "项目里的收录");
    writeCapture(join(state, "shared", "knowledge"), "cap-dup", "共享副本同 id");
    writeCapture(join(state, "shared", "knowledge"), "cap-shared-only", "只在共享里的收录");

    const { entries } = await buildLibraryIndex({ stateDir: state });
    const captures = entries.filter((e) => e.type === "capture");
    expect(captures).toHaveLength(3);
    expect(captures.filter((e) => e.sourcePath === "cap-dup")).toHaveLength(1);
    const titles = captures.map((e) => e.title).sort();
    expect(titles).toEqual(["只在共享里的收录", "平铺的收录", "项目里的收录"].sort());
  });
});