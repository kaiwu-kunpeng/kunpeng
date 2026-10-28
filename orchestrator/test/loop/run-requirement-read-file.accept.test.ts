import { describe, expect, test } from "vitest";
import { resolveRequirementInput } from "../../src/cli-commands/devcycle.js";

const deps = (files: Record<string, string>) => ({
  exists: (path: string) => Object.prototype.hasOwnProperty.call(files, path),
  read: (path: string) => {
    const value = files[path];
    if (value === undefined) throw new Error(`ENOENT ${path}`);
    return value;
  },
});

describe("run 需求解析:文件路径要读成内容", () => {
  test("一句话需求原样透传", () => {
    expect(resolveRequirementInput("给对话加个导出按钮", deps({}))).toEqual({ requirement: "给对话加个导出按钮" });
  });

  test("存在的 .md 路径读成内容并记录来源", () => {
    const out = resolveRequirementInput("/specs/a.spec.md", deps({ "/specs/a.spec.md": "# 标题\n正文" }));
    expect(out.requirement).toBe("# 标题\n正文");
    expect(out.sourcePath).toBe("/specs/a.spec.md");
  });

  test("不存在的 .md 路径降级为原样字符串", () => {
    expect(resolveRequirementInput("/specs/missing.spec.md", deps({}))).toEqual({ requirement: "/specs/missing.spec.md" });
  });

  test("读文件抛异常时降级,不抛出", () => {
    const boom = { exists: () => true, read: () => { throw new Error("EACCES"); } };
    expect(() => resolveRequirementInput("/specs/x.md", boom)).not.toThrow();
    expect(resolveRequirementInput("/specs/x.md", boom)).toEqual({ requirement: "/specs/x.md" });
  });

  test("内容全空白视同读不到", () => {
    expect(resolveRequirementInput("/specs/b.md", deps({ "/specs/b.md": "   \n  " }))).toEqual({ requirement: "/specs/b.md" });
  });

  test("多行需求即使以 .md 结尾也不读盘", () => {
    const multi = "第一行\n第二行 a.md";
    expect(resolveRequirementInput(multi, deps({ [multi]: "不该被读到" }))).toEqual({ requirement: multi });
  });

  test("空输入返回空需求", () => {
    expect(resolveRequirementInput("   ", deps({}))).toEqual({ requirement: "" });
  });
});