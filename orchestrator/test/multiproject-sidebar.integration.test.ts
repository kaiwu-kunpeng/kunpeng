import { afterEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProject } from "../src/project/registry.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { startDashboard } from "../src/server/http.js";

let cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs = [];
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function viewUrl(base: string, route: string): string {
  return `${base}/api/view?${new URLSearchParams({ route }).toString()}`;
}

test("dashboard shell lists registered projects and project views use each project's own state", async () => {
  const stateDir = makeTempDir("kp-multiproject-state-");
  const alphaParent = makeTempDir("kp-multiproject-alpha-");
  const betaParent = makeTempDir("kp-multiproject-beta-");
  const alphaRepo = join(alphaParent, "alpha");
  const betaRepo = join(betaParent, "beta");
  mkdirSync(alphaRepo);
  mkdirSync(betaRepo);

  await registerProject({ repoPath: alphaRepo, stateDir, now: 1 });
  await registerProject({ repoPath: betaRepo, stateDir, now: 2 });
  await new FlowTracker(join(alphaRepo, ".kunpeng", "state")).start("a1", "alpha flow");
  await new FlowTracker(join(betaRepo, ".kunpeng", "state")).start("b1", "beta flow");

  const srv = await startDashboard({ port: 0, stateDir });
  try {
    const base = `http://127.0.0.1:${srv.port}`;

    const shell = await fetch(`${base}/`);
    const shellHtml = await shell.text();
    expect(shell.status).toBe(200);
    expect(shellHtml).toContain('href="#/project/alpha"');
    expect(shellHtml).toContain('href="#/project/beta"');

    const beta = await fetch(viewUrl(base, "#/project/beta/flows"));
    const betaHtml = await beta.text();
    expect(beta.status).toBe(200);
    expect(betaHtml).toContain("b1");
    expect(betaHtml).not.toContain("a1");

    const alpha = await fetch(viewUrl(base, "#/project/alpha/flows"));
    const alphaHtml = await alpha.text();
    expect(alpha.status).toBe(200);
    expect(alphaHtml).toContain("a1");
    expect(alphaHtml).not.toContain("b1");
  } finally {
    srv.close();
  }
});
