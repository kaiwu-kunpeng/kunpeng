import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/plugin.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { cloneGitSource, gitCacheDir, gitHeadOf, isGitUrl } from "../../src/plugin/git-source.js";
import { MARKETPLACE_FILE, diagnosePlugins, installCommand, parseMarketplace, sourceLabel, type Marketplace } from "../../src/plugin/marketplace.js";
import { listPlugins } from "../../src/plugin/store.js";
import { listSkills, skillsRoot } from "../../src/skills/registry.js";

// 背景（2026-10-03 插件审计 A1 S2 / K1，总报告 P1-7 第三步；前置 P1-7a/7b 已合入）：装了就换不了版——升级只能 remove 再 add，
// 技能/MCP 注册表断档；没有回退；git 来源一律拒收。本测试锁定：git 来源 url+commit 钉版（clone→checkout→复核 HEAD，幂等）；
// marketplace.json 收 git 条目，doctor 查已装目录 HEAD 与钉的 commit；`kunpeng plugin add <git url> --commit`、
// `upgrade`（命令行来源或市场来源，只升不降，原启用则换注册技能后重新启用）、`rollback`（换回 previous，可来回）。

const dirs: string[] = [];
let savedState: string | undefined;
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commitEnvArgs = ["-c", "user.name=demo", "-c", "user.email=demo@example.com", "-c", "commit.gpgsign=false"];

function writePlugin(dir: string, version: string, skillBody: string): void {
  mkdirSync(join(dir, "skills", "demo-skill"), { recursive: true });
  writeFileSync(join(dir, "kunpeng-plugin.json"), JSON.stringify({ name: "demo-pack", version }), "utf8");
  writeFileSync(join(dir, "skills", "demo-skill", "SKILL.md"), `---\nname: demo-skill\ndescription: 演示技能\n---\n${skillBody}\n`, "utf8");
}

/** 真 git 仓：两个提交分别是 demo-pack 1.0.0 / 1.1.0，返回 file:// url 与两个 commit。 */
function makeRepo(): { url: string; c1: string; c2: string } {
  const repo = tmp("kp-plug-git-");
  git(["-C", repo, "init", "-q", "-b", "main"]);
  writePlugin(repo, "1.0.0", "第一版");
  git(["-C", repo, "add", "."]); git(["-C", repo, ...commitEnvArgs, "commit", "-q", "-m", "v1"]);
  const c1 = git(["-C", repo, "rev-parse", "HEAD"]).trim();
  writePlugin(repo, "1.1.0", "第二版");
  git(["-C", repo, "add", "."]); git(["-C", repo, ...commitEnvArgs, "commit", "-q", "-m", "v2"]);
  const c2 = git(["-C", repo, "rev-parse", "HEAD"]).trim();
  return { url: `file://${repo}`, c1, c2 };
}

beforeEach(() => { savedState = process.env.KUNPENG_STATE; process.env.KUNPENG_STATE = tmp("kp-plug-up-state-"); });
afterEach(() => {
  if (savedState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = savedState;
  process.exitCode = 0; vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("git 来源（作者锁定）", () => {
  it("clone 到钉死的 commit 并复核 HEAD；同 commit 缓存幂等；坏 url / 坏 commit / 不存在的 commit 拒绝且不留半成品目录", () => {
    const { url, c1, c2 } = makeRepo();
    expect(isGitUrl("https://x/y.git") && isGitUrl("git@x:y/z.git") && isGitUrl("ssh://x/y") && isGitUrl(url)).toBe(true);
    expect(isGitUrl("/local/dir") || isGitUrl("./rel") || isGitUrl("x.kpkg")).toBe(false);
    const root = tmp("kp-plug-root-");
    const dest = gitCacheDir(root, "https://x/Y_Kit.git", c1.toUpperCase());
    expect(dest).toBe(join(root, "cache", `y-kit-${c1.slice(0, 12)}`));
    const got = cloneGitSource({ url, commit: c1, destDir: dest });
    expect(got).toBe(dest);
    expect(JSON.parse(readFileSync(join(dest, "kunpeng-plugin.json"), "utf8"))).toEqual({ name: "demo-pack", version: "1.0.0" });
    expect(gitHeadOf(dest)).toBe(c1);
    const runGit = vi.fn((args: string[]) => git(args));
    expect(cloneGitSource({ url, commit: c1.toUpperCase(), destDir: dest, runGit })).toBe(dest);
    expect(runGit.mock.calls.map((c) => c[0][2])).toEqual(["rev-parse"]);
    expect(gitHeadOf(dest, () => "not-a-sha")).toBeUndefined();
    expect(gitHeadOf(tmp("kp-plug-nogit-"))).toBeUndefined();
    const dest2 = join(root, "cache", "second");
    expect(() => cloneGitSource({ url: "/not/a/url", commit: c2, destDir: dest2 })).toThrow(/url 须为 https\/ssh\/git@\/file/);
    expect(() => cloneGitSource({ url, commit: "abc", destDir: dest2 })).toThrow(/必须钉 commit（40 位十六进制）/);
    expect(() => cloneGitSource({ url, commit: "0".repeat(40), destDir: dest2 })).toThrow(/git 来源拉取失败/);
    expect(existsSync(dest2)).toBe(false);
    expect(gitHeadOf(cloneGitSource({ url, commit: c2, destDir: dest2 }))).toBe(c2);
  });

  it("marketplace.json 收 git 条目（url+40 位 commit 钉版，commit 归一小写）；doctor 查 HEAD 不符 / 不可读；fix 给带 --commit 的安装命令", () => {
    const commit = "A".repeat(40);
    const m = parseMarketplace(JSON.stringify({ entries: [{ name: "g-kit", source: { kind: "git", url: "https://x/y.git", commit }, distribution: "required" }] }));
    expect(m.entries[0]!.source).toEqual({ kind: "git", url: "https://x/y.git", commit: "a".repeat(40) });
    expect(sourceLabel(m.entries[0]!.source)).toBe(`git:https://x/y.git@${"a".repeat(12)}`);
    expect(sourceLabel({ kind: "local", path: "/p" })).toBe("local:/p");
    expect(installCommand(m.entries[0]!)).toBe(`kunpeng plugin add https://x/y.git --commit ${"a".repeat(40)} --enable`);
    const bad = (source: unknown, re: RegExp) => expect(() => parseMarketplace(JSON.stringify({ entries: [{ name: "a", source }] }))).toThrow(re);
    bad({ kind: "git", url: "https://x/y.git" }, /entries\[0\].*git 来源必须钉 commit（40 位十六进制）/);
    bad({ kind: "git", url: "https://x/y.git", commit: "abc" }, /git 来源必须钉 commit/);
    bad({ kind: "git", url: "/local/path", commit }, /git 来源 url 须为 https\/ssh\/git@\/file 地址/);
    bad({ kind: "svn", path: "/x" }, /source.kind 须为 local\/kpkg\/git/);
    const market: Marketplace = m;
    const installed = [{ name: "g-kit", version: "1.0.0", dir: "/i/g", enabled: true }];
    expect(diagnosePlugins({ marketplace: market, installed, dirExists: () => true, gitHead: () => "a".repeat(40) })).toEqual([]);
    expect(diagnosePlugins({ marketplace: market, installed, dirExists: () => true })).toEqual([]);
    expect(diagnosePlugins({ marketplace: market, installed, dirExists: () => true, gitHead: () => "b".repeat(40) })).toEqual([{
      severity: "error", plugin: "g-kit",
      issue: `git commit 与市场钉的不符（已装 ${"b".repeat(12)}，市场钉 ${"a".repeat(12)}）`,
      fix: `kunpeng plugin upgrade g-kit 换到市场钉的 commit，或核对 ${MARKETPLACE_FILE}`,
    }]);
    expect(diagnosePlugins({ marketplace: market, installed, dirExists: () => true, gitHead: () => undefined }).map((f) => [f.severity, f.issue.split("：")[0]])).toEqual([["warn", "git 目录 HEAD 不可读"]]);
    expect(diagnosePlugins({ marketplace: market, installed: [], dirExists: () => true, gitHead: () => undefined })[0]!.fix).toBe(installCommand(m.entries[0]!));
  });
});

describe("kunpeng plugin add --commit / upgrade / rollback（作者锁定）", () => {
  it("git add 须 --commit；upgrade 走命令行或市场来源、只升不降、换注册技能并保持启用；rollback 换回 previous 且可来回", async () => {
    const { url, c1, c2 } = makeRepo();
    const stateDir = process.env.KUNPENG_STATE!;
    const pluginsRootDir = join(stateDir, "plugins"); mkdirSync(pluginsRootDir, { recursive: true });
    const out: string[] = []; const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((line: string) => { errors.push(String(line)); });
    const command = listCliCommands().find((c) => c.name === "plugin")!;
    const run = async (rest: string[]) => { process.exitCode = 0; out.length = 0; errors.length = 0; await command.run({ repoRoot: stateDir, rest, argv: ["plugin", ...rest] } as never); return process.exitCode ?? 0; };
    const record = async () => (await listPlugins(pluginsRootDir)).find((p) => p.name === "demo-pack")!;
    const skillDir = () => listSkills(skillsRoot()).find((s) => s.id === "demo-skill")!.dir;

    expect(await run(["add", url, "--enable"])).toBe(1);
    expect(errors.join("\n")).toContain("--commit");
    expect(await listPlugins(pluginsRootDir)).toEqual([]);
    expect(await run(["add", url, "--commit", c1, "--enable"])).toBe(0);
    const v1 = await record();
    expect([v1.version, v1.enabled, v1.dir, v1.previous]).toEqual(["1.0.0", true, gitCacheDir(pluginsRootDir, url, c1), undefined]);
    expect(skillDir()).toBe(join(v1.dir, "skills", "demo-skill"));

    // 不是更新版本：拒绝，登记不动
    const localV1 = tmp("kp-plug-local-"); writePlugin(localV1, "1.0.0", "本地同版");
    expect(await run(["upgrade", "demo-pack", localV1])).toBe(1);
    expect(errors.join("\n")).toContain("不是更新版本");
    expect((await record()).version).toBe("1.0.0");
    // 名字不符：拒绝
    const other = tmp("kp-plug-other-"); writeFileSync(join(other, "kunpeng-plugin.json"), JSON.stringify({ name: "other-pack", version: "9.0.0" }));
    expect(await run(["upgrade", "demo-pack", other])).toBe(1);
    expect(errors.join("\n")).toContain("不符");
    // 没来源也没市场：拒绝并指路
    expect(await run(["upgrade", "demo-pack"])).toBe(1);
    expect(errors.join("\n")).toContain("marketplace.json");

    // 市场来源 git@c2 → 升到 1.1.0，技能注册换目录，仍启用，previous 记旧版
    writeFileSync(join(pluginsRootDir, MARKETPLACE_FILE), JSON.stringify({ entries: [{ name: "demo-pack", source: { kind: "git", url, commit: c2 } }] }));
    expect(await run(["upgrade", "demo-pack"])).toBe(0);
    expect(out.join("\n")).toContain("已升级 demo-pack 1.0.0 → 1.1.0");
    const v2 = await record();
    expect([v2.version, v2.enabled, v2.dir]).toEqual(["1.1.0", true, gitCacheDir(pluginsRootDir, url, c2)]);
    expect(gitHeadOf(v2.dir)).toBe(c2);
    expect(v2.previous).toMatchObject({ version: "1.0.0", dir: v1.dir, skills: ["demo-skill"] });
    expect(skillDir()).toBe(join(v2.dir, "skills", "demo-skill"));
    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf8")).toContain("第二版");
    expect(await run(["doctor"])).toBe(0);

    // rollback → 1.0.0，previous 记 1.1.0；再 rollback 回 1.1.0
    expect(await run(["rollback", "demo-pack"])).toBe(0);
    expect(out.join("\n")).toContain("已回退 demo-pack 1.1.0 → 1.0.0");
    const back = await record();
    expect([back.version, back.enabled, back.dir, back.previous?.version, back.previous?.dir]).toEqual(["1.0.0", true, v1.dir, "1.1.0", v2.dir]);
    expect(skillDir()).toBe(join(v1.dir, "skills", "demo-skill"));
    expect(await run(["rollback", "demo-pack"])).toBe(0);
    expect((await record()).version).toBe("1.1.0");

    // 停用状态下升级：升级后保持停用；previous 目录丢失时 rollback 拒绝
    expect(await run(["disable", "demo-pack"])).toBe(0);
    const localV2 = tmp("kp-plug-local2-"); writePlugin(localV2, "1.2.0", "本地新版");
    expect(await run(["upgrade", "demo-pack", localV2])).toBe(0);
    const v3 = await record();
    expect([v3.version, v3.enabled, v3.previous?.version]).toEqual(["1.2.0", false, "1.1.0"]);
    rmSync(v3.previous!.dir, { recursive: true, force: true });
    expect(await run(["rollback", "demo-pack"])).toBe(1);
    expect(errors.join("\n")).toContain("上一版本目录不在");
    expect((await record()).version).toBe("1.2.0");
    expect(await run(["rollback", "ghost-pack"])).toBe(1);
    expect(errors.join("\n")).toContain("未找到插件");
  });
});