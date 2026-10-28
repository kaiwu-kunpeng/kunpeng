import { describe, expect, test } from "vitest";
import { changelogEntryFromRequirement } from "../../src/dossier/changelog.js";

describe("changelogEntryFromRequirement（作者锁定）", () => {
  test("取第一个 H1 作标题，条目带 flowId", () => {
    const r = changelogEntryFromRequirement("# 新增 CLI 参考索引\n\n**背景**\n- 正文", "flow-a1");
    expect(r).toEqual({ category: "Added", entry: "新增 CLI 参考索引（flow-a1）" });
  });

  test("分类优先级：Security > Fixed > Removed > Deprecated > Added > Changed", () => {
    expect(changelogEntryFromRequirement("# 修复知识库抓取的 SSRF 绕过", "f")?.category).toBe("Security");
    expect(changelogEntryFromRequirement("# 修复看板幽灵流", "f")?.category).toBe("Fixed");
    expect(changelogEntryFromRequirement("# prompt-shield 补两处漏检", "f")?.category).toBe("Fixed");
    expect(changelogEntryFromRequirement("# 删除 5 个死导出", "f")?.category).toBe("Removed");
    expect(changelogEntryFromRequirement("# 废弃旧版 board 接口", "f")?.category).toBe("Deprecated");
    expect(changelogEntryFromRequirement("# 新增成本看板", "f")?.category).toBe("Added");
    expect(changelogEntryFromRequirement("# 通用 helper 收拢到单一来源", "f")?.category).toBe("Changed");
  });

  test("没有 H1 时取第一个非空行，去掉前导 # 与 ** 标记", () => {
    const r = changelogEntryFromRequirement("\n\n**背景（事实）** 看板刷新\n# 不是第一行", "f2");
    expect(r?.entry).toBe("不是第一行（f2）");
    const r2 = changelogEntryFromRequirement("\n\n**支持导出 CSV**\n正文", "f3");
    expect(r2).toEqual({ category: "Added", entry: "支持导出 CSV（f3）" });
  });

  test("标题压空白并截到 120 字，超长补省略号", () => {
    const long = "# " + "字".repeat(130);
    const r = changelogEntryFromRequirement(long, "f4");
    expect(r?.entry).toBe("字".repeat(120) + "…（f4）");
    expect(changelogEntryFromRequirement("#   多个   空白\t标题  ", "f5")?.entry).toBe("多个 空白 标题（f5）");
  });

  test("需求为空时返回 null", () => {
    expect(changelogEntryFromRequirement("   \n  ", "f6")).toBeNull();
  });
});