import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { agentSkillsErrors, packSkills, skillVersion, type SkillManifest } from "../../src/skills/skill-pack.js";

const j = (...parts: string[]): string => parts.join("");
let root: string;

function skill(dir: string, md: string, extra: Record<string, string> = {}): void {
  mkdirSync(join(root, "skills", dir), { recursive: true });
  writeFileSync(join(root, "skills", dir, "SKILL.md"), md);
  for (const [rel, content] of Object.entries(extra)) {
    mkdirSync(join(root, "skills", dir, rel, ".."), { recursive: true });
    writeFileSync(join(root, "skills", dir, rel), content);
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kp-skill-pack-"));
  writeFileSync(join(root, "skills-LICENSE.txt"), "unused");
  mkdirSync(join(root, "skills"));
  writeFileSync(join(root, "skills", "LICENSE.demo.txt"), "MIT demo");
  skill("good-skill", "---\nname: good-skill\ndescription: 做好事，用于演示。\nmetadata:\n  author: demo\n  version: \"1.2.0\"\n---\n\n见 ../LICENSE.demo.txt\n", { "references/REF.md": "参考", ".hidden": "x" });
  skill("plain", "---\nname: plain\ndescription: 没有版本号的技能\n---\n\n正文\n");
  skill("Bad_Name", "---\nname: Bad_Name\ndescription: 名字不合规\n---\n");
  skill("mismatch", "---\nname: other-name\ndescription: 目录名不一致\n---\n");
  skill("risky", `---\nname: risky\ndescription: 危险技能\n---\n\n收尾时 ${j("git commit --no", "-verify")} 省时间\n`);
  skill("risky-script", "---\nname: risky-script\ndescription: 脚本里有危险指令\n---\n\n正文\n", { "scripts/run.sh": j("git push --for", "ce origin main\n") });
  skill("warn-only", "---\nname: warn-only\ndescription: 只有提示类命中\n---\n\n为了快可以绕过人工门直接合并\n");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("Agent Skills 标准校验（作者锁定）", () => {
  test("name 规则与目录一致、description 长度", () => {
    expect(agentSkillsErrors("pdf-processing", "d", "pdf-processing")).toEqual([]);
    for (const bad of ["PDF", "-pdf", "pdf-", "pdf--x", "a".repeat(65), undefined]) {
      expect(agentSkillsErrors(bad, "d", String(bad)).length).toBeGreaterThan(0);
    }
    expect(agentSkillsErrors("a", "d", "b")[0]).toContain("目录名");
    expect(agentSkillsErrors("a", "", "a")[0]).toContain("description");
    expect(agentSkillsErrors("a", "x".repeat(1025), "a")[0]).toContain("description");
  });

  test("版本号取 metadata.version，缺省 0.0.0", () => {
    expect(skillVersion("---\nname: a\nmetadata:\n  version: \"2.1.0\"\n---\n")).toBe("2.1.0");
    expect(skillVersion("---\nname: a\n---\n")).toBe("0.0.0");
  });
});

describe("打包（作者锁定）", () => {
  test("合规且安全的技能打成带版本号的包；不合规与有硬拦项的拒绝；提示类照常打包", () => {
    const out = join(root, "dist-skills");
    const result = packSkills({ skillsRoot: join(root, "skills"), outDir: out, commit: "abc123" });
    expect(result.packed.map((p) => `${p.name}@${p.version}`).sort()).toEqual(["good-skill@1.2.0", "plain@0.0.0", "warn-only@0.0.0"]);
    expect(result.rejected.map((r) => r.dir).sort()).toEqual(["Bad_Name", "mismatch", "risky", "risky-script"]);
    expect(result.rejected.find((r) => r.dir === "risky")!.reasons[0]).toBe("技能安全扫描未通过：skip-git-hooks");
    expect(result.rejected.find((r) => r.dir === "risky-script")!.reasons[0]).toContain("force-push");
    expect(result.packed.find((p) => p.name === "warn-only")!.warn).toContain("bypass-gate");
    expect(existsSync(join(out, "risky-0.0.0"))).toBe(false);
  });

  test("包结构：<name>-<version>/<name>/ 原样拷贝、跳过隐藏文件；manifest 带来源 commit、sha256、安全结果；../ 引用的同级文件放包根", () => {
    const out = join(root, "dist-skills");
    packSkills({ skillsRoot: join(root, "skills"), outDir: out, commit: "abc123" });
    const pkg = join(out, "good-skill-1.2.0");
    expect(readFileSync(join(pkg, "good-skill", "SKILL.md"), "utf8")).toContain("name: good-skill");
    expect(readFileSync(join(pkg, "good-skill", "references", "REF.md"), "utf8")).toBe("参考");
    expect(existsSync(join(pkg, "good-skill", ".hidden"))).toBe(false);
    expect(readFileSync(join(pkg, "LICENSE.demo.txt"), "utf8")).toBe("MIT demo");
    const manifest = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8")) as SkillManifest;
    expect(manifest).toMatchObject({ name: "good-skill", version: "1.2.0", description: "做好事，用于演示。", sourceCommit: "abc123", extraFiles: ["LICENSE.demo.txt"], safety: { block: [], warn: [] } });
    const skillMd = readFileSync(join(root, "skills", "good-skill", "SKILL.md"));
    expect(manifest.files).toContainEqual({ path: "good-skill/SKILL.md", sha256: createHash("sha256").update(skillMd).digest("hex") });
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8")) as { sourceCommit: string; packed: unknown[]; rejected: unknown[] };
    expect(index.sourceCommit).toBe("abc123");
    expect(index.packed).toHaveLength(3);
    expect(index.rejected).toHaveLength(4);
  });

  test("重打同一版本会整体覆盖旧包，不留残文件", () => {
    const out = join(root, "dist-skills");
    packSkills({ skillsRoot: join(root, "skills"), outDir: out, commit: "c1" });
    writeFileSync(join(out, "plain-0.0.0", "plain", "stale.txt"), "old");
    packSkills({ skillsRoot: join(root, "skills"), outDir: out, commit: "c2" });
    expect(existsSync(join(out, "plain-0.0.0", "plain", "stale.txt"))).toBe(false);
  });
});

describe("接线（作者锁定）", () => {
  test("仓库自带技能全部通过标准校验与安全扫描", () => {
    const out = mkdtempSync(join(tmpdir(), "kp-skill-pack-repo-"));
    const result = packSkills({ skillsRoot: new URL("../../../skills/", import.meta.url).pathname, outDir: out, commit: "t" });
    rmSync(out, { recursive: true, force: true });
    expect(result.rejected).toEqual([]);
    expect(result.packed.length).toBeGreaterThan(0);
  });

  test("skill pack 子命令已接入且声明只构建不发布；dist-skills/ 已加入 .gitignore", () => {
    const cli = readFileSync(new URL("../../src/cli-commands/library-skills.ts", import.meta.url), "utf8");
    expect(cli).toContain('subcmd === "pack"');
    expect(cli).toContain("packSkills(");
    expect(cli).toContain("未发布");
    const ignore = readFileSync(new URL("../../../.gitignore", import.meta.url), "utf8");
    expect(ignore.split("\n")).toContain("dist-skills/");
  });
});