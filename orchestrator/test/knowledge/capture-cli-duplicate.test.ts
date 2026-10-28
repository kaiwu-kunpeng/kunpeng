import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCapture } from "../../src/knowledge/capture-cli.js";
import { CaptureStore } from "../../src/knowledge/capture-store.js";

const LONG = "这是一段足够长的正文内容，用来触发内容级去重护栏，凑齐一百二十个字符以上。".repeat(5);

describe("重复内容捕获优雅拒绝", () => {
  it("第二次同内容 runCapture 返回 duplicate 标记而不抛异常", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cap-cli-dup-"));
    const store = new CaptureStore(dir, undefined, null);
    let n = 0;
    const deps = {
      store,
      now: () => 1719900000000 + n,
      newId: () => `cap-cli-${n++}`,
    };
    const first = await runCapture({ kind: "text", value: LONG }, deps as never);
    expect((first as { duplicate?: boolean }).duplicate).toBeUndefined();

    const second = await runCapture({ kind: "text", value: LONG }, deps as never);
    expect((second as { duplicate?: boolean }).duplicate).toBe(true);

    expect(await store.listCaptures()).toHaveLength(1);
  });
});