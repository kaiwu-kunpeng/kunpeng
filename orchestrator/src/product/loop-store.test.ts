import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { initState } from "./stage-machine.js";
import {
  productLoopDir,
  readBrief,
  readBuildSpec,
  readLoopState,
  readSpec,
  writeBrief,
  writeBuildSpec,
  writeLoopState,
  writeSpec,
} from "./loop-store.js";
import type { DesignBrief } from "../design/brief-gate.js";

async function tmpRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kp-loopstore-"));
}

describe("loop-store", () => {
  test("productLoopDir is .kunpeng/product/<slug>", () => {
    expect(productLoopDir("/repo", "my-slug")).toBe(join("/repo", ".kunpeng", "product", "my-slug"));
  });

  test("state round-trips and lands at <slug>/state.json", async () => {
    const repo = await tmpRepo();
    const s = initState("dash", "仪表盘", 1000);
    await writeLoopState(repo, s);
    expect(await readLoopState(repo, "dash")).toEqual(s);
    const onDisk = JSON.parse(await readFile(join(productLoopDir(repo, "dash"), "state.json"), "utf8"));
    expect(onDisk.slug).toBe("dash");
  });

  test("spec round-trips", async () => {
    const repo = await tmpRepo();
    await writeSpec(repo, "dash", "# spec\nhello");
    expect(await readSpec(repo, "dash")).toBe("# spec\nhello");
  });

  test("brief round-trips", async () => {
    const repo = await tmpRepo();
    const brief: DesignBrief = {
      projectType: "x", audience: "y", primaryGoal: "z", tone: "克制",
      mustHave: ["a"], forbidden: ["b"], techStack: "TS", locale: "zh", successMetric: "ok",
    };
    await writeBrief(repo, "dash", brief);
    expect(await readBrief(repo, "dash")).toEqual(brief);
  });

  test("missing files return undefined (not throw)", async () => {
    const repo = await tmpRepo();
    expect(await readLoopState(repo, "none")).toBeUndefined();
    expect(await readSpec(repo, "none")).toBeUndefined();
    expect(await readBrief(repo, "none")).toBeUndefined();
  });

  test("build-spec 落盘可回读", async () => {
    const repo = await tmpRepo();
    expect(await readBuildSpec(repo, "slug-a")).toBeUndefined();
    await writeBuildSpec(repo, "slug-a", "# 段一\n\n```accept\ntest -f x\n```");
    expect(await readBuildSpec(repo, "slug-a")).toContain("```accept");
  });
});
