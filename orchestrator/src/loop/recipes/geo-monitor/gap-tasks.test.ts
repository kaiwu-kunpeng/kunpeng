import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGeoMonitorWave } from "./runwave.js";
import type { LoopDef } from "../../types.js";

function geoLoop(): LoopDef {
  return {
    id: "g", name: "G", projectId: "p", recipe: "geo-monitor", autonomous: true,
    metric: { key: "geoMentions", label: "提及", current: 0 },
    levers: [{ id: "geo-sweep", label: "扫", status: "active" }],
    nextLever: { lever: "geo-sweep" },
    waves: [], createdAt: 1, updatedAt: 1,
  };
}

const miss = JSON.stringify({ summary: "s", citedDomains: ["rival.com"], mentionedBrand: false });

describe("GEO 缺口自动转任务", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kp-gt-"));
    mkdirSync(join(repo, ".kunpeng", "geo"), { recursive: true });
    writeFileSync(join(repo, ".kunpeng", "geo", "config.json"), JSON.stringify({
      brandNames: ["B"], brandDomains: ["b.ai"], questions: ["q-one", "q-two"],
    }));
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("缺口建任务、同题去重、建失败不影响波次", async () => {
    const runner = { run: async () => ({ text: miss, meta: {} }) };
    const created: Array<{ title: string }> = [];
    const deps = {
      agentRunner: runner, repoPath: repo, now: 1,
      listTasks: async () => created,
      createTask: async (_root: string, t: { title: string }) => { created.push(t); return t; },
    };
    const r1 = await runGeoMonitorWave(geoLoop(), "geo-sweep", undefined, deps);
    expect(r1.verified).toBe(true);
    expect(created.length).toBe(2);
    expect(created[0].title).toContain("GEO 内容缺口");
    expect(created[0].title).toContain("q-one");

    await runGeoMonitorWave(geoLoop(), "geo-sweep", undefined, { ...deps, now: 2 });
    expect(created.length).toBe(2);

    const boom = { ...deps, now: 3, createTask: async () => { throw new Error("store down"); }, listTasks: async () => [] };
    const r3 = await runGeoMonitorWave(geoLoop(), "geo-sweep", undefined, boom);
    expect(r3.verified).toBe(true);
  });
});