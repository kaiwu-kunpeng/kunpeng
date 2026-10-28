import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCockpit } from "../support/cockpit-e2e.js";

async function seedTemplate(stateDir: string): Promise<void> {
  const dir = join(stateDir, "solutions", "t1");
  await mkdir(join(dir, "playbooks"), { recursive: true });
  await writeFile(join(dir, "template.json"), JSON.stringify({ id: "t1", name: "T1", playbookFiles: ["pb.md"], loopFiles: [], createdAt: "2026-01-01" }), "utf8");
  await writeFile(join(dir, "playbooks", "pb.md"), ["---", "id: pb", "---", "# 卡"].join("\n"), "utf8");
}

describe("POST /api/solutions/apply(真 serve)", () => {
  it("缺参 400;未知模板 404;成功 200 且 playbook 落进目标仓", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "kp-solapply-state-"));
    const repo = await mkdtemp(join(tmpdir(), "kp-solapply-repo-"));
    await seedTemplate(stateDir);
    await withCockpit(repo, async ({ baseUrl }) => {
      const bad = await fetch(baseUrl + "/api/solutions/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      expect(bad.status).toBe(400);

      const ghost = await fetch(baseUrl + "/api/solutions/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "ghost", projectId: "p" }) });
      expect(ghost.status).toBe(404);

      const ok = await fetch(baseUrl + "/api/solutions/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "t1", projectId: "p" }) });
      expect(ok.status).toBe(200);
      const j = await ok.json();
      expect(j.ok).toBe(true);
      expect(j.written).toEqual(["pb.md"]);
      const pb = await readFile(join(repo, ".kunpeng", "playbooks", "pb.md"), "utf8");
      expect(pb).toContain("projectId: p");
    }, { stateDir });
  }, 30000);
});