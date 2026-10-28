import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-http-autopilot-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/autopilot runs autopilot for current project and returns JSON", async () => {
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  await tracker.start("x", "verified flow");
  await tracker.finish("x", "verified", { gate: "合并主干 (人工门#1)", what: "kp/x → main" });

  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/autopilot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "current" }),
    });
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.merged)).toBe(true);
    expect(Array.isArray(body.skipped)).toBe(true);
  } finally {
    srv.close();
  }
});
