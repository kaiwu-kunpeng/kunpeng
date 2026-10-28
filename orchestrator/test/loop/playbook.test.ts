import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlaybook, listPlaybooks, PLAYBOOK_SECTIONS } from "../../src/loop/playbook.js";

const MD = `---
id: acme-catalog
projectId: acme-shop
recipe: acme-catalog
loopId: acme-catalog
cadence: weekly
gate: auto
conversionGoal: pwq|parts-with-quote 可索引报价页
---
# Acme 扩品类循环

## 检查节奏
每周一检查薄弱品类雷达。

## 何时行动
存在报价供应商 < 3 的品类时。

## 动手前自检
确认 Neon 连接与 xcrawl 配额。

## 状态与幂等
去重 key = 品类 enum 名；冷却窗 7 天。

## 止损与上报
连续两轮 delta=0 → 停并进 review inbox。

## 产出落位
prisma schema + 页面 + wave 记录。
`;

describe("parsePlaybook", () => {
  it("frontmatter + 六段全解析", () => {
    const p = parsePlaybook(MD);
    expect(p).not.toBeNull();
    expect(p!.id).toBe("acme-catalog");
    expect(p!.projectId).toBe("acme-shop");
    expect(p!.title).toBe("Acme 扩品类循环");
    expect(p!.gate).toBe("auto");
    expect(p!.cadence).toBe("weekly");
    expect(p!.conversionGoal).toEqual({ key: "pwq", label: "parts-with-quote 可索引报价页" });
    for (const s of PLAYBOOK_SECTIONS) expect(Object.keys(p!.sections)).toContain(s);
    expect(p!.sections["止损与上报"]).toContain("review inbox");
  });

  it("无 frontmatter 走默认：gate=review、id 用 fallback", () => {
    const p = parsePlaybook("# 极简配方\n\n## 检查节奏\n每天。\n", "mini");
    expect(p).not.toBeNull();
    expect(p!.id).toBe("mini");
    expect(p!.gate).toBe("review");
    expect(p!.title).toBe("极简配方");
  });

  it("空内容返回 null", () => {
    expect(parsePlaybook("", "x")).toBeNull();
    expect(parsePlaybook("   \n  ", "x")).toBeNull();
  });
});

describe("listPlaybooks", () => {
  it("读目录、坏档跳过、按 id 排序；目录缺失返回空", async () => {
    const root = await mkdtemp(join(tmpdir(), "pb-"));
    expect(await listPlaybooks(root)).toEqual([]);
    const dir = join(root, ".kunpeng", "playbooks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "b-second.md"), "# 乙配方\n## 检查节奏\n每周。\n");
    await writeFile(join(dir, "a-first.md"), MD);
    await writeFile(join(dir, "empty.md"), "");
    const list = await listPlaybooks(root);
    expect(list.map((p) => p.id)).toEqual(["b-second", "acme-catalog"].sort());
  });
});