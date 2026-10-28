import { describe, expect, it, vi } from "vitest";
import { postMergeBuild, shouldPostMergeBuild } from "../../src/runtime/post-merge-build.js";

describe("合并后自动重建 dist 并冒烟（作者锁定）", () => {
  it("只在鲲鹏自己的仓（有 orchestrator/package.json 与 dist）且未被 KUNPENG_POST_MERGE_BUILD=0 关掉时才跑", () => {
    const all = () => true;
    expect(shouldPostMergeBuild("/r", {}, all)).toBe(true);
    expect(shouldPostMergeBuild("/r", { KUNPENG_POST_MERGE_BUILD: "0" }, all)).toBe(false);
    expect(shouldPostMergeBuild("/r", {}, (p) => !p.endsWith("dist"))).toBe(false);
    expect(shouldPostMergeBuild("/r", {}, (p) => !p.endsWith("package.json"))).toBe(false);
  });

  it("build 成功 + 冒烟成功 → ran/ok/version；build 失败 → ok=false 带错误尾巴；不该跑 → ran=false", async () => {
    const run = vi.fn(async (cmd: string, args: string[], cwd: string) => {
      expect(cwd).toBe("/r/orchestrator");
      if (cmd === "npm") return { code: 0, stdout: "", stderr: "" };
      if (cmd === "node" && args[0] === "dist/cli.js" && args[1] === "version") return { code: 0, stdout: "1.1.0\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected" };
    });
    const ok = await postMergeBuild("/r", { run, env: {} });
    expect(ok).toMatchObject({ ran: true, ok: true, version: "1.1.0" });
    expect(run.mock.calls[0]!.slice(0, 2)).toEqual(["npm", ["run", "build"]]);

    const failing = vi.fn(async (cmd: string) => cmd === "npm" ? { code: 1, stdout: "", stderr: "TS2322: boom" } : { code: 0, stdout: "x", stderr: "" });
    const bad = await postMergeBuild("/r", { run: failing, env: {} });
    expect(bad.ran).toBe(true);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("TS2322");
    expect(failing).toHaveBeenCalledTimes(1);

    const skipped = await postMergeBuild("/r", { run, env: { KUNPENG_POST_MERGE_BUILD: "0" } });
    expect(skipped).toEqual({ ran: false, ok: true });
  });
});