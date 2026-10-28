import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { writeValidation, readValidation } from "../../src/product/loop-store.js";

describe("validation 存储契约", () => {
  test("写后回读 decision 一致", async () => {
    const repo = await mkdtemp(join(tmpdir(), "p3-val-"));
    await writeValidation(repo, "s", { hypotheses: ["h"], signals: [], decision: "inconclusive", rationale: "r", requiresHumanGate: true });
    expect((await readValidation(repo, "s"))?.decision).toBe("inconclusive");
  });
});
