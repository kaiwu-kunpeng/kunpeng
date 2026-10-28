import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const META_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const IN_GIT = existsSync(join(META_ROOT, ".git"));
const gitignore = readFileSync(join(META_ROOT, ".gitignore"), "utf8")
  .split("\n")
  .map((l) => l.trim());

describe("内部文件不再进仓(作者锁定)", () => {
  it(".gitignore 忽略客户截图目录与 orchestrator 子项目运行态", () => {
    expect(gitignore).toContain(".tmp-shots/");
    expect(gitignore).toContain("orchestrator/.kunpeng/");
  });

  it("原有忽略项未被误删", () => {
    for (const l of [".env", ".kunpeng/state/", ".kunpeng/captures", ".kunpeng/accounts.json", ".DS_Store"]) {
      expect(gitignore, `缺 ${l}`).toContain(l);
    }
  });

  it("工作树里不再有客户截图目录与内部 spec 副本", () => {
    expect(existsSync(join(META_ROOT, ".tmp-shots"))).toBe(false);
    expect(existsSync(join(META_ROOT, "orchestrator", ".kunpeng", "specs", "localfs-op-queue-hasauthz-reject-copy.md"))).toBe(false);
  });

  it.skipIf(!IN_GIT)("git 索引里这两处不再有任何仍存在于磁盘的文件", () => {
    const out = execFileSync("git", ["ls-files", "--", ".tmp-shots", "orchestrator/.kunpeng"], {
      cwd: META_ROOT,
      encoding: "utf8",
    });
    const stillOnDisk = out
      .split("\n")
      .filter(Boolean)
      .filter((f) => existsSync(join(META_ROOT, f)));
    expect(stillOnDisk).toEqual([]);
  });
});
