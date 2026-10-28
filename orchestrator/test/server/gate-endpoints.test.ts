import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";

import { FlowTracker } from "../../src/runtime/flowstate.js";
import { startDashboard } from "../../src/server/http.js";

let repoRoot: string;
let tracker: FlowTracker;

async function setupGateRepo() {
  repoRoot = mkdtempSync(join(tmpdir(), "kp-gate-endpoints-"));
  const git = simpleGit(repoRoot);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repoRoot, "base.txt"), "base\n");
  await git.add("base.txt");
  await git.commit("base");

  tracker = new FlowTracker(join(repoRoot, ".kunpeng", "state"));
  await tracker.start("g1", "merge gate");
  await tracker.finish("g1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/g1 -> main" });

  await git.checkoutLocalBranch("kp/g1");
  writeFileSync(join(repoRoot, "feature.txt"), "feature\n");
  await git.add("feature.txt");
  await git.commit("feature");
  await git.checkout("main");
}

async function getJson(port: number, path: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return await response.json() as Record<string, unknown>;
}

async function postJson(port: number, path: string, body: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await response.json() as Record<string, unknown>;
}

beforeEach(async () => {
  await setupGateRepo();
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("gate HTTP endpoints", () => {
  test("GET /api/gates/diagnosis 列出门并带诊断", async () => {
    const server = await startDashboard({ port: 0, repoRoot });
    try {
      const body = await getJson(server.port, "/api/gates/diagnosis");
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.gates)).toBe(true);
      const gate = (body.gates as Record<string, unknown>[]).find((item) => item.flowId === "g1");
      expect(gate).toBeTruthy();
      expect(gate).toHaveProperty("status");
      expect(gate).toHaveProperty("commitsBehind");
      expect(gate).toHaveProperty("conflictFiles");
    } finally {
      server.close();
    }
  });

  test("POST /api/gates/discard 清门", async () => {
    const server = await startDashboard({ port: 0, repoRoot });
    try {
      const body = await postJson(server.port, "/api/gates/discard", { flowId: "g1" });
      expect(body.ok).toBe(true);
      expect((await tracker.read("g1"))?.humanGate).toBeUndefined();
    } finally {
      server.close();
    }
  });

  test("discard 缺 flowId→ok:false", async () => {
    const server = await startDashboard({ port: 0, repoRoot });
    try {
      const body = await postJson(server.port, "/api/gates/discard", {});
      expect(body.ok).toBe(false);
      expect(body.error).toBe("缺 flowId");
    } finally {
      server.close();
    }
  });

  test("discard 不存在的 flowId→ok:false 未找到", async () => {
    const server = await startDashboard({ port: 0, repoRoot });
    try {
      const body = await postJson(server.port, "/api/gates/discard", { flowId: "missing" });
      expect(body.ok).toBe(false);
      expect(body.error).toBe("未找到该门");
    } finally {
      server.close();
    }
  });
});
