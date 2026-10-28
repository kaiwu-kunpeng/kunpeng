import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readProductSessionView } from "../../src/server/state.js";
import { writeInterview } from "../../src/product/store.js";
import { draftSpecForDefinition } from "../../src/product/loop-orchestrate.js";
import { writeBuildSpec } from "../../src/product/loop-store.js";
import { productSlug } from "../../src/product/artifacts.js";
import type { ProductDefinition } from "../../src/product/contract.js";

const def: ProductDefinition = {
  idea: "仪表盘", problem: "p", users: ["u"], stories: ["s"], acceptance: ["a"], nonGoals: [],
};

describe("readProductSessionView loop", () => {
  test("includes loop stage state once spec drafted", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-psv-"));
    await writeInterview(repo, { idea: "仪表盘", status: "done", step: 5, answers: ["1", "2", "3", "4", "5"], definition: def });
    await draftSpecForDefinition(repo, def, 1000);
    const view = await readProductSessionView(repo);
    expect(view?.loop?.currentStage).toBe("spec");
    expect(view?.loop?.stages.spec.status).toBe("drafted");
    expect(view?.loop?.spec?.includes("仪表盘")).toBe(true);
  });

  test("loop 透传 buildSpec", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-psv3-"));
    await writeInterview(repo, { idea: "仪表盘", status: "done", step: 5, answers: ["1", "2", "3", "4", "5"], definition: def });
    await draftSpecForDefinition(repo, def, 1000);
    await writeBuildSpec(repo, productSlug(def.idea), "# 段一\nBUILDSPEC内容");
    const view = await readProductSessionView(repo);
    expect(view?.loop?.buildSpec).toContain("BUILDSPEC内容");
  });

  test("loop is undefined before any spec drafted", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-psv2-"));
    await writeInterview(repo, { idea: "x", status: "in-progress", step: 1, answers: ["1"] });
    const view = await readProductSessionView(repo);
    expect(view?.loop).toBeUndefined();
  });
});
