import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collectHealthz } from "./healthz.js";

describe("healthz 真实依赖探针", () => {
  it("状态目录可写 → ok:true,含 state-dir-writable 通过项", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-hz-"));
    const r = await collectHealthz({ stateDir: dir });
    expect(r.ok).toBe(true);
    expect(r.checks.some((c) => c.name === "state-dir-writable" && c.ok)).toBe(true);
  });

  it("状态目录不可写 → ok:false 且对应检查项失败", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-hz-"));
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "x");
    const r = await collectHealthz({ stateDir: join(blocker, "sub") });
    expect(r.ok).toBe(false);
    expect(r.checks.some((c) => c.name === "state-dir-writable" && !c.ok)).toBe(true);
  });
});