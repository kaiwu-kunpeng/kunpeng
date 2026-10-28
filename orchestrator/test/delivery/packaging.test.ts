import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const root = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string; files: string[]; bin: Record<string, string>;
};
const ENV_FILE = [".", "env"].join("");

describe("商业交付打包基线", () => {
  it("package.json 版本与 CHANGELOG 已发布版本不再矛盾", () => {
    expect(pkg.version).toBe("1.2.0");
    expect(root("CHANGELOG.md")).toContain("## [1.2.0]");
  });

  it("打包范围仍只含 dist,入口未被改坏", () => {
    expect(pkg.files).toEqual(["dist"]);
    expect(pkg.bin.kunpeng).toBe("dist/cli.js");
  });

  it("客户环境文件被忽略,但范例文件未被误伤", () => {
    const lines = root(".gitignore").split("\n").map((l) => l.trim());
    expect(lines).toContain(ENV_FILE);
    expect(lines).not.toContain(`${ENV_FILE}.example`);
  });

  it("SECURITY.md 存在且交代了报告方式与不公开披露要求", () => {
    const s = root("SECURITY.md");
    expect(s.length).toBeGreaterThan(200);
    expect(s).toMatch(/security@/);
    expect(s).toMatch(/公开披露|不要公开/);
  });

  it("容器不以 root 运行且有健康检查", () => {
    const d = root("Dockerfile");
    expect(d).toMatch(/^USER node$/m);
    expect(d).toMatch(/HEALTHCHECK/);
    expect(d).toContain('ENTRYPOINT ["node", "dist/cli.js"]');
  });

  it("README 交代了许可与支持入口", () => {
    const r = root("README.md");
    expect(r).toMatch(/许可与支持/);
    expect(r).toMatch(/LICENSE/);
    expect(r).toMatch(/SECURITY\.md/);
    expect(r).toMatch(/THIRD-PARTY-NOTICES/);
  });
});