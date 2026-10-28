import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

async function postJson(port: number, path: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.headers.get("content-type")).toContain("application/json");
  return res.json();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-http-distill-skill-"));
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/distill-skill distills verified experience into a skill file", async () => {
  await new ArtifactStore(join(repo, ".kunpeng", "artifacts")).write({
    kind: "experience",
    id: "exp-1",
    status: "verified",
    body: "合并后必对抗审查",
    meta: { outcome: "verified" },
  });

  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/distill-skill", {
      projectId: "current",
      name: "Merge Discipline",
      description: "合并后必对抗审查",
    });
    expect(body.ok).toBe(true);
    expect(body.experienceCount).toBe(1);
    expect(body.path).toContain("merge-discipline/SKILL.md");
    expect(existsSync(body.path)).toBe(true);
  } finally {
    srv.close();
  }
});

test("POST /api/distill-skill reports empty experience store", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/distill-skill", { projectId: "current", name: "Empty" });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("无经验可蒸馏");
  } finally {
    srv.close();
  }
});

test("POST /api/distill-skill reports missing name", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/distill-skill", { projectId: "current" });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("缺技能名称");
  } finally {
    srv.close();
  }
});
