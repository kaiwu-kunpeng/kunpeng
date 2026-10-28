import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCockpit } from "../support/cockpit-e2e.js";

async function seedTemplate(stateDir: string): Promise<void> {
  const dir = join(stateDir, "solutions", "t1");
  await mkdir(join(dir, "playbooks"), { recursive: true });
  await mkdir(join(dir, "loops"), { recursive: true });
  await writeFile(join(dir, "template.json"), JSON.stringify({ id: "t1", name: "T1", playbookFiles: ["pb.md"], loopFiles: ["la.json", "lb.json"], createdAt: "2026-01-01" }), "utf8");
  await writeFile(join(dir, "playbooks", "pb.md"), ["---", "id: pb", "---", "# 卡"].join("\n"), "utf8");
  await writeFile(join(dir, "loops", "la.json"), JSON.stringify({ id: "la", recipe: "agent-playbook", autonomous: true, waves: [] }), "utf8");
  await writeFile(join(dir, "loops", "lb.json"), JSON.stringify({ id: "lb", recipe: "agent-playbook", autonomous: false, waves: [] }), "utf8");
}

describe("POST /api/solutions/apply run=true(真 serve)", () => {
  it("只把新装且 autonomous 的 loop 拉起首波;不传 run 则不拉", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "kp-solrun-state-"));
    const repo = await mkdtemp(join(tmpdir(), "kp-solrun-repo-"));
    await seedTemplate(stateDir);
    await withCockpit(repo, async ({ baseUrl }) => {
      const ok = await fetch(baseUrl + "/api/solutions/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "t1", projectId: "p", run: true }) });
      expect(ok.status).toBe(200);
      const j = await ok.json();
      expect(j.ok).toBe(true);
      expect(j.loopsWritten).toEqual(["la.json", "lb.json"]);
      expect(Array.isArray(j.autoRun)).toBe(true);
      expect(j.autoRun.length).toBe(1);
      expect(j.autoRun[0].loopId).toBe("la");
      expect(typeof j.autoRun[0].pid).toBe("number");
      expect(typeof j.autoRun[0].logPath).toBe("string");

      const again = await fetch(baseUrl + "/api/solutions/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "t1", projectId: "p" }) });
      expect(again.status).toBe(200);
      const j2 = await again.json();
      expect(j2.autoRun ?? []).toEqual([]);
    }, { stateDir });
  }, 30000);
});