import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("write then read a spec round-trips", async () => {
  const store = new ArtifactStore(dir);
  const a = await store.write({
    kind: "spec", id: "s1", status: "draft",
    body: "# Req\nbuild X", meta: { acceptance: ["X works"] },
  });
  expect(a.id).toBe("s1");
  const back = await store.read("s1");
  expect(back.kind).toBe("spec");
  expect(back.status).toBe("draft");
  expect(back.body).toContain("build X");
  expect(back.meta.acceptance).toEqual(["X works"]);
});

test("legal transition draft -> approved succeeds", async () => {
  const store = new ArtifactStore(dir);
  await store.write({ kind: "spec", id: "s1", status: "draft", body: "x", meta: {} });
  const moved = await store.transition("s1", "approved");
  expect(moved.status).toBe("approved");
});

test("illegal transition draft -> verified throws", async () => {
  const store = new ArtifactStore(dir);
  await store.write({ kind: "spec", id: "s1", status: "draft", body: "x", meta: {} });
  await expect(store.transition("s1", "verified")).rejects.toThrow(/illegal transition/);
});

test("any state can roll back", async () => {
  const store = new ArtifactStore(dir);
  await store.write({ kind: "task", id: "t1", status: "in-progress", body: "x", meta: {} });
  const rb = await store.transition("t1", "rolled-back");
  expect(rb.status).toBe("rolled-back");
});

test("list filters by kind", async () => {
  const store = new ArtifactStore(dir);
  await store.write({ kind: "spec", id: "s1", status: "draft", body: "x", meta: {} });
  await store.write({ kind: "experience", id: "e1", status: "draft", body: "y", meta: {} });
  const exps = await store.list("experience");
  expect(exps.map((a) => a.id)).toEqual(["e1"]);
  const all = await store.list();
  expect(all.length).toBe(2);
});

test("list 跳过坏 artifact（schema 外 status），不拖垮整张清单", async () => {
  const { writeFileSync } = await import("node:fs");
  const store = new ArtifactStore(dir);
  await store.write({ kind: "spec", id: "good", status: "draft", body: "ok", meta: {} });
  // 写一个 schema 外 status 的坏 artifact（模拟遗留 rejected）——曾导致 collectState 抛错、总控台空白。
  writeFileSync(join(dir, "bad.md"), "---\nkind: proposal\nid: bad\nstatus: rejected\nmeta: {}\n---\n\nbody\n");
  const all = await store.list();
  expect(all.map((a) => a.id)).toEqual(["good"]); // 坏的被跳过，好的照常返回
});

test("治本：body 以 --- 开头（水平线/frontmatter 式）round-trip 完整、不被 gray-matter 吞", async () => {
  const store = new ArtifactStore(dir);
  for (const body of ["---\n\n# 标题\n正文很重要", "---\nkey: val\n---\n正文", "正常正文", "前\n---\n后"]) {
    await store.write({ kind: "proposal", id: "p", status: "draft", body, meta: {} });
    expect((await store.read("p")).body.trim()).toBe(body.trim());
  }
});
