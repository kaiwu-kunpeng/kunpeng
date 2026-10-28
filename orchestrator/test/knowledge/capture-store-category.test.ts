import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CaptureStore, newCapture } from "../../src/knowledge/capture-store.js";

test("CaptureStore preserves category across append and list", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kp-capture-category-"));
  try {
    const store = new CaptureStore(dir, undefined, null);
    const capture = newCapture(
      { source: "text", kind: "note", raw: "r", category: "战略" },
      { now: () => 1718000000000, id: () => "cap-category-store" },
    );

    await expect(store.appendCapture(capture)).resolves.toBe(true);
    const captures = await store.listCaptures();

    expect(captures).toHaveLength(1);
    expect(captures[0]?.category).toBe("战略");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
