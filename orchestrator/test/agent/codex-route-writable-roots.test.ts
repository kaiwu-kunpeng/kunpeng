import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { codexAdapter } from "../../src/agent/backend-adapter.js";

const saved = process.env.KUNPENG_CODEX_WRITABLE_ROOTS;
afterEach(() => {
  if (saved === undefined) delete process.env.KUNPENG_CODEX_WRITABLE_ROOTS; else process.env.KUNPENG_CODEX_WRITABLE_ROOTS = saved;
});

function addDirs(args: string[]): string[] {
  const out: string[] = [];
  args.forEach((a, i) => { if (a === "--add-dir" && i + 1 < args.length) out.push(args[i + 1]!); });
  return out;
}

describe("route.writableRoots → --add-dir（作者锁定）", () => {
  it("route 里的绝对路径去重成 --add-dir；相对路径跳过；与 env 合并且 env 在前", () => {
    delete process.env.KUNPENG_CODEX_WRITABLE_ROOTS;
    const only = codexAdapter.invoke({ writableRoots: ["/tmp/kp-r1", "relative/x", "/tmp/kp-r1", "/tmp/kp-r2"] }, []);
    expect(addDirs(only.args)).toEqual(["/tmp/kp-r1", "/tmp/kp-r2"]);
    expect(only.args.indexOf("--skip-git-repo-check")).toBeLessThan(only.args.indexOf("--add-dir"));

    process.env.KUNPENG_CODEX_WRITABLE_ROOTS = "/tmp/kp-env:/tmp/kp-r1";
    const merged = codexAdapter.invoke({ model: "gpt-5", writableRoots: ["/tmp/kp-r1", "/tmp/kp-r2"] }, []);
    expect(addDirs(merged.args)).toEqual(["/tmp/kp-env", "/tmp/kp-r1", "/tmp/kp-r2"]);
    expect(merged.args.indexOf("--add-dir")).toBeLessThan(merged.args.indexOf("-m"));
  });

  it("不给 writableRoots 且无 env → 没有 --add-dir（安全5 行为不变）", () => {
    delete process.env.KUNPENG_CODEX_WRITABLE_ROOTS;
    expect(codexAdapter.invoke({}, []).args).not.toContain("--add-dir");
  });

  it("cli-runner 两条调用路径都给 codex 传 collectToolchainWritableRoots(cwd)", () => {
    const src = readFileSync(new URL("../../src/agent/cli-runner.ts", import.meta.url), "utf8");
    expect((src.match(/collectToolchainWritableRoots\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("writableRoots");
  });
});