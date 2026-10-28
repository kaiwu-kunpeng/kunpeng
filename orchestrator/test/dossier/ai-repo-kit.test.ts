import { describe, it, expect } from "vitest";
import { buildAiRepoKit } from "../../src/dossier/ai-repo-kit.js";

describe("buildAiRepoKit", () => {
  it("产出恰好 4 个文件,path 固定且有序", () => {
    const files = buildAiRepoKit({ projectName: "acme" });
    expect(files.map((f) => f.path)).toEqual([
      "AGENTS.md",
      "docs/domain-knowledge.md",
      "docs/specs/README.md",
      "skills/README.md",
    ]);
  });

  it("AGENTS.md 含项目名与北极星", () => {
    const files = buildAiRepoKit({ projectName: "acme", northStar: "净省工时" });
    const agents = files.find((f) => f.path === "AGENTS.md")!;
    expect(agents.content).toContain("# acme · AGENTS");
    expect(agents.content).toContain("北极星：净省工时");
  });

  it("AGENTS.md 含不准乱删非范围文件的纪律提示", () => {
    const agents = buildAiRepoKit({ projectName: "x" }).find((f) => f.path === "AGENTS.md")!;
    expect(agents.content).toContain("范围");
  });

  it("领域知识按 domains 渲染小节,空则占位", () => {
    const withDomains = buildAiRepoKit({ projectName: "x", domains: ["支付", "履约"] });
    const dk = withDomains.find((f) => f.path === "docs/domain-knowledge.md")!;
    expect(dk.content).toContain("## 支付");
    expect(dk.content).toContain("## 履约");

    const empty = buildAiRepoKit({ projectName: "x" }).find((f) => f.path === "docs/domain-knowledge.md")!;
    expect(empty.content).toContain("(待补充)");
  });

  it("确定性:同输入同输出", () => {
    const a = buildAiRepoKit({ projectName: "x", domains: ["a"] });
    const b = buildAiRepoKit({ projectName: "x", domains: ["a"] });
    expect(a).toEqual(b);
  });
});