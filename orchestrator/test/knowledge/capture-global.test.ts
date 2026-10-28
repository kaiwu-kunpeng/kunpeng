import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { CaptureStore } from "../../src/knowledge/capture-store.js";
import { runCapture } from "../../src/knowledge/capture-cli.js";

describe("capture --global 落全局池 + sourceProfileId", () => {
  it("runCapture 带 sourceProfileId 落入指定(全局)store，listCaptures 取回", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-gkb-"));
    const store = new CaptureStore(join(dir, "knowledge"), undefined, null);
    const stored = await runCapture(
      { kind: "text", value: "通用教训:并发改同文件要单写者", sourceProfileId: "home" },
      { store, fetchUrl: async () => { throw new Error("unexpected fetch"); }, readFile: async () => { throw new Error("unexpected file read"); }, now: () => 1000, newId: () => "cap-g1" },
    );
    expect(stored.sourceProfileId).toBe("home");
    const all = await store.listCaptures();
    expect(all.find((c) => c.id === "cap-g1")?.sourceProfileId).toBe("home");
    await rm(dir, { recursive: true, force: true });
  });
  it("不带 sourceProfileId 仍可落盘(向后兼容)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-gkb-"));
    const store = new CaptureStore(join(dir, "knowledge"), undefined, null);
    const stored = await runCapture(
      { kind: "text", value: "x" },
      { store, fetchUrl: async () => { throw new Error("unexpected fetch"); }, readFile: async () => { throw new Error("unexpected file read"); }, now: () => 1, newId: () => "cap-g2" },
    );
    expect(stored.id).toBe("cap-g2");
    await rm(dir, { recursive: true, force: true });
  });
});
