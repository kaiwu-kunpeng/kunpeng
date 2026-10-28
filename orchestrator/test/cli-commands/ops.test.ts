import { describe, it, expect } from "vitest";
import "../../src/cli-commands/ops.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { loopStore } from "../../src/cli-commands/shared.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("运营命令组析出到 CLI 注册表", () => {
  it("注册了 ops-pilot/ops-report/loops/solution/ops", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["ops-pilot", "ops-report", "loops", "solution", "ops"]) {
      expect(names).toContain(name);
    }
  });

  it("loopStore 从 shared 可用且指向 .kunpeng/loops", async () => {
    const store = loopStore(mkdtempSync(join(tmpdir(), "kp-ops-")));
    expect(await store.list()).toEqual([]);
  });
});