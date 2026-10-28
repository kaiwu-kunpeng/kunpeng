import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

const getEvalReport = async (port: number, id: string) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/eval-report?projectId=current&id=${encodeURIComponent(id)}`);
  expect(res.headers.get("content-type")).toContain("application/json");
  return res.json();
};

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-eval-report-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("GET /api/eval-report renders EvalReport from proposal evidence", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({
    kind: "proposal",
    id: "prop-1",
    status: "draft",
    body: "提案：强化错误处理规约",
    meta: {
      proposal: {
        evidence: {
          holdoutPassK: 0.8,
          costPerResolvedTask: 1.2,
          baseline: { holdoutPassK: 0.6 },
        },
      },
    },
  });

  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await getEvalReport(srv.port, "prop-1");
    expect(body.ok).toBe(true);
    expect(body.report.baselinePassK).toBe(0.6);
    expect(body.report.candidatePassK).toBe(0.8);
    expect(Math.abs(body.report.delta - 0.2)).toBeLessThan(1e-9);
    expect(body.report.improved).toBe(true);
    expect(typeof body.report.markdown).toBe("string");
    expect(body.report.markdown).toContain("+20.0%");
  } finally {
    srv.close();
  }
});

test("GET /api/eval-report returns ok:false when proposal has no evidence", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({ kind: "proposal", id: "prop-2", status: "draft", body: "无证据提案", meta: {} });

  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await getEvalReport(srv.port, "prop-2");
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("prop-2");
  } finally {
    srv.close();
  }
});

test("GET /api/eval-report returns ok:false for an unknown proposal id", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await getEvalReport(srv.port, "prop-missing");
    expect(body.ok).toBe(false);
  } finally {
    srv.close();
  }
});
