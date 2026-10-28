import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";
import * as autopilot from "../../src/loop/autopilot.js";
import { startDashboard } from "../../src/server/http.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-no-auto-approve-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

/** 旧通道会自动批准的那种提案：只动 conventions、holdout 证据严格变强。 */
async function seedLowRiskProposal(store: ArtifactStore): Promise<void> {
  await store.write({
    kind: "proposal", id: "patrol-lowrisk", status: "draft", body: "# 提案",
    meta: {
      proposal: {
        sourceExperiences: [], rejected: [],
        changes: [{ target: "conventions", text: "据 https://example.com 调研：一条约定", source: "research:https://example.com" }],
        evidence: { holdoutPassK: 0.9, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.5 } },
      },
    },
  });
}

describe("进化提案只能人批：autopilot 自动批准通道已删除（宪法 C5#2 / C6，作者锁定）", () => {
  test("autopilot 模块不再导出提案自动批准函数", () => {
    expect("runProposalAutopilot" in autopilot).toBe(false);
  });

  test("POST /api/autopilot 即使带 proposals:true 也不批准任何提案，响应里没有 approvedProposals", async () => {
    const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
    await seedLowRiskProposal(store);
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/autopilot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "current", proposals: true }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body).not.toHaveProperty("approvedProposals");
    } finally {
      srv.close();
    }
    expect((await store.read("patrol-lowrisk")).status).toBe("draft");
  });

  test("CLI 不再有 --proposals 分支；专测旧通道的测试文件已删；帮助文档不再提 --proposals", () => {
    const loopCore = readFileSync(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");
    expect(loopCore).not.toContain("--proposals");
    expect(existsSync(new URL("../proposal-autopilot.test.ts", import.meta.url))).toBe(false);
    const help = readFileSync(new URL("../../../docs/help/02-user-guide/cli-reference.md", import.meta.url), "utf8");
    expect(help).not.toContain("--proposals");
  });
});