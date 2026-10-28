import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { CaptureStore, type Capture } from "../../src/knowledge/capture-store.js";

const tempDirs: string[] = [];

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "cap-distill",
    source: "text",
    kind: "note",
    raw: "知识卡片需要按需逐层深读，并保留原始内容作为安全网。",
    summary: "知识卡片按需深读",
    tags: ["knowledge", "distill"],
    createdAt: 100,
    promoted: false,
    ...overrides,
  };
}

async function makeStore(): Promise<CaptureStore> {
  const dir = await mkdtemp(join(tmpdir(), "kunpeng-distill-capture-"));
  tempDirs.push(dir);
  return new CaptureStore(join(dir, ".kunpeng", "captures"), undefined, null);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CaptureStore distillCapture", () => {
  test("persists distill text and level through listCaptures", async () => {
    const store = await makeStore();
    const item = capture();
    await store.appendCapture(item);

    const updated = await store.distillCapture(item.id, "- 要点A\n- 要点B", 1);
    expect(updated?.distill).toBe("- 要点A\n- 要点B");
    expect(updated?.distillLevel).toBe(1);

    const captures = await store.listCaptures();
    const found = captures.find((cap) => cap.id === item.id);
    expect(found?.distill).toBe("- 要点A\n- 要点B");
    expect(found?.distillLevel).toBe(1);
  });

  test("returns null for missing captures", async () => {
    const store = await makeStore();

    await expect(store.distillCapture("不存在", "x", 1)).resolves.toBeNull();
  });

  test("overwrites distill text and level on repeated distill", async () => {
    const store = await makeStore();
    const item = capture({ id: "cap-repeat" });
    await store.appendCapture(item);

    await store.distillCapture(item.id, "- 要点A\n- 要点B", 1);
    await store.distillCapture(item.id, "精华", 2);

    const captures = await store.listCaptures();
    const found = captures.find((cap) => cap.id === item.id);
    expect(found?.distill).toBe("精华");
    expect(found?.distillLevel).toBe(2);
  });
});
