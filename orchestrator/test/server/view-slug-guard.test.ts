import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { readProductSessionViewForSlug } from "../../src/server/state-projections.js";

const BAD = ["..", "../..", "../../etc", "a/b", "", "./x"];

describe("视图读取路径的 slug 守卫", () => {
  it("穿越型与空 slug 一律返回 undefined", async () => {
    const root = await mkdtemp(join(tmpdir(), "kp-viewslug-"));
    for (const bad of BAD) {
      await expect(
        readProductSessionViewForSlug(root, bad),
        `应拒绝: ${JSON.stringify(bad)}`,
      ).resolves.toBeUndefined();
    }
    await rm(root, { recursive: true, force: true });
  });

  it("repoRoot 不存在时传穿越 slug 也不抛错", async () => {
    await expect(
      readProductSessionViewForSlug("/nonexistent-kp-root-xyz", ".."),
    ).resolves.toBeUndefined();
  });

  it("合法但不存在的 slug 仍返回 undefined（行为不回退）", async () => {
    const root = await mkdtemp(join(tmpdir(), "kp-viewslug-ok-"));
    await expect(
      readProductSessionViewForSlug(root, "no-such-product"),
    ).resolves.toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });
});