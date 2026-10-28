import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowRepoStore } from "../../src/server/flow-repo-store.js";

function pathIn(dir: string) { return join(dir, "flow-repos.json"); }

describe("FlowRepoStore(作者验收)", () => {
  it("set 后 get 一致,且落盘(新实例同路径可读回)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-flowrepo-"));
    const p = pathIn(dir);
    const a = new FlowRepoStore(p);
    a.set("flow-1", "/repo/one");
    expect(a.get("flow-1")).toBe("/repo/one");
    const b = new FlowRepoStore(p);
    expect(b.get("flow-1")).toBe("/repo/one");
    expect(b.get("missing")).toBeUndefined();
  });

  it("超过 max 裁掉最旧、保留最新", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-flowrepo2-"));
    const s = new FlowRepoStore(pathIn(dir), 3);
    s.set("a", "/a"); s.set("b", "/b"); s.set("c", "/c"); s.set("d", "/d");
    expect(s.get("a")).toBeUndefined();
    expect(s.get("d")).toBe("/d");
    expect(s.get("b")).toBe("/b");
  });

  it("损坏文件 → get 返回 undefined,不抛", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-flowrepo3-"));
    const p = pathIn(dir);
    writeFileSync(p, "{ broken");
    const s = new FlowRepoStore(p);
    expect(s.get("x")).toBeUndefined();
    expect(() => s.set("y", "/y")).not.toThrow();
  });
});