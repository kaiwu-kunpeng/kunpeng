import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readBuildSpec, writeBuildSpec } from "../../src/product/loop-store.js";

// 端点逻辑薄，核心是落盘；此处直测 store 契约（端点真串线见 Task 8 e2e）。
describe("build-spec 保存契约", () => {
  test("保存后回读一致", async () => {
    const repo = await mkdtemp(join(tmpdir(), "p2-http-"));
    await writeBuildSpec(repo, "s", "# 段一\nEDITED\n\n```accept\ntest -f y\n```");
    expect(await readBuildSpec(repo, "s")).toContain("EDITED");
  });
});
