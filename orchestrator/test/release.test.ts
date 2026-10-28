import { describe, it, expect } from "vitest";
import { bumpSemver, rollUnreleased, readVersionField, writeVersionField } from "../src/dossier/release.js";

describe("bumpSemver", () => {
  it("patch/minor/major", () => {
    expect(bumpSemver("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpSemver("0.1.9", "minor")).toBe("0.2.0");
    expect(bumpSemver("1.2.3", "major")).toBe("2.0.0");
  });
  it("非法报错", () => { expect(() => bumpSemver("abc", "patch")).toThrow(); });
});

describe("readVersionField / writeVersionField", () => {
  it("读写 version", () => {
    const pkg = '{\n  "name": "x",\n  "version": "0.1.0"\n}\n';
    expect(readVersionField(pkg)).toBe("0.1.0");
    expect(readVersionField(writeVersionField(pkg, "0.2.0"))).toBe("0.2.0");
  });
});

describe("rollUnreleased", () => {
  it("Unreleased 内容滚成版本节,Unreleased 头保留", () => {
    const cl = "# Changelog\n\n## [Unreleased]\n\n### Added\n- 新功能\n\n## [0.1.0] - 2026-06-14\n\n### Added\n- 老功能\n";
    const out = rollUnreleased(cl, "0.2.0", "2026-06-20");
    expect(out).toContain("## [Unreleased]");
    expect(out).toContain("## [0.2.0] - 2026-06-20");
    expect(out).toContain("## [0.1.0] - 2026-06-14");
    expect(out).toContain("- 老功能");
    expect(out.indexOf("新功能")).toBeGreaterThan(out.indexOf("## [0.2.0]"));
    expect(out.indexOf("新功能")).toBeLessThan(out.indexOf("## [0.1.0]"));
    const unrelToVer = out.slice(out.indexOf("## [Unreleased]"), out.indexOf("## [0.2.0]"));
    expect(unrelToVer).not.toContain("新功能");
  });
  it("无 Unreleased -> 文末追加版本节", () => {
    const out = rollUnreleased("# Changelog\n", "0.1.0", "2026-06-20");
    expect(out).toContain("## [0.1.0] - 2026-06-20");
  });
});
