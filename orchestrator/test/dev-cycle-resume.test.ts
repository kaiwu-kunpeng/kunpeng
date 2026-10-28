import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { Workspace } from "../src/git/workspace.js";
import type { AgentRunner, AgentRequest } from "../src/agent/runner.js";
import { DevCycle } from "../src/loop/dev-cycle.js";

let repo: string, store: ArtifactStore, ws: Workspace;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-resume-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("resume=true 且已持久化 spec 存在 → 跳过 spec 阶段、复用产物喂下游", async () => {
  await store.write({
    kind: "spec",
    id: "rz1",
    status: "draft",
    body: "## acceptance\n- prints ok",
    meta: { testCmd: "node -e \"process.exit(0)\"" },
  });
  const seen: string[] = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push(req.stage);
      return { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({ store, ws, runner: recording, flowId: "rz1", resume: true });
  const result = await dc.run("原始需求（resume 时应忽略，改用持久化 spec）");
  expect(result.status).toBe("verified");
  expect(seen).not.toContain("spec");
  expect(seen).toContain("implement");
});

test("resume=false（缺省）→ 行为不变，spec 阶段照常跑", async () => {
  const seen: string[] = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push(req.stage);
      return req.stage === "spec"
        ? { text: "## acceptance", meta: { testCmd: "node -e \"process.exit(0)\"" } }
        : { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({ store, ws, runner: recording, flowId: "rz2" });
  const result = await dc.run("需求");
  expect(result.status).toBe("verified");
  expect(seen).toContain("spec");
});