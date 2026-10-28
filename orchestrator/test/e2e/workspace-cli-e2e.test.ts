import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import simpleGit from "simple-git";
import { describe, it, expect } from "vitest";

const run = promisify(execFile);
const CLI = join(process.cwd(), "dist", "cli.js"); // accept 先 npm run build 产出 dist

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-e2e-"));
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "t@t.dev");
  await g.addConfig("user.name", "t");
  await g.raw(["commit", "--allow-empty", "-m", "init"]);
  return dir;
}

// 真 dist 子进程 e2e：默认跳过(慢/起真子进程，并发负载下会 flaky 击穿 per-flow 差分门)，accept 用 KP_E2E=1 触发。
describe.runIf(process.env.KP_E2E === "1")("workspace CLI 跨进程 e2e（真 dist 子进程）", () => {
  it("acquire→身份自动解析→release留分支→abandon删分支(各自独立进程)", async () => {
    const repo = await initRepo();
    const state = await mkdtemp(join(tmpdir(), "kp-state-"));
    const env = { ...process.env, KUNPENG_STATE: state };

    await run("node", [CLI, "workspace", "acquire", "wa", "--repo", repo], { env });
    const wtPath = join(repo, ".kunpeng", "wt", "wa");
    expect((await readFile(join(wtPath, ".kunpeng-instance"), "utf8")).trim()).toBe("wa");
    expect((await simpleGit(repo).branch()).all).toContain("kp/wa");

    const { stdout } = await run("node", [CLI, "inbox"], { cwd: wtPath, env });
    expect(stdout).toContain("wa");

    await run("node", [CLI, "workspace", "release", "wa", "--repo", repo], { env });
    await expect(access(wtPath)).rejects.toBeTruthy();
    expect((await simpleGit(repo).branch()).all).toContain("kp/wa");

    await run("node", [CLI, "workspace", "acquire", "wb", "--repo", repo], { env });
    await run("node", [CLI, "workspace", "abandon", "wb", "--repo", repo], { env });
    expect((await simpleGit(repo).branch()).all).not.toContain("kp/wb");

    await rm(repo, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }, 120000);
});
