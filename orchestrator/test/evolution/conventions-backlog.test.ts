import { expect, test, vi } from "vitest";
import {
  CONVENTIONS_BACKLOG_PREFIX,
  CONVENTIONS_BACKLOG_SOURCE,
  CONVENTIONS_TARGET_REL,
  acceptanceAnchor,
  backlogConventionsApplier,
  conventionsBacklogTask,
  conventionsLanded,
} from "../../src/evolution/conventions-backlog.js";
import type { ProposedChange } from "../../src/loop/self-evolution.js";

const conv = (text: string, source = "exp-1"): ProposedChange => ({ target: "conventions", text, source });

test("常量：前缀 / 来源 / 目标相对路径固定", () => {
  expect(CONVENTIONS_BACKLOG_PREFIX).toBe("[proposal-conventions]");
  expect(CONVENTIONS_BACKLOG_SOURCE).toBe("proposal:conventions");
  expect(CONVENTIONS_TARGET_REL).toBe("constitution/conventions.md");
});

test("acceptanceAnchor：取不含引号/反引号/反斜杠/美元/换行的最长片段，最多 40 字，两端去空白", () => {
  expect(acceptanceAnchor("PR 必须带验证证据 (C3)")).toBe("PR 必须带验证证据 (C3)");
  expect(acceptanceAnchor("spec 必带 `scope` 块(allow/forbid glob):未声明则范围门直接跳过、越界改动会溜进集成")).toBe(
    "块(allow/forbid glob):未声明则范围门直接跳过、越界改动会溜进集成".slice(0, 40),
  );
  expect(acceptanceAnchor("a 'b' c")).toBe("a");
  expect(acceptanceAnchor("x".repeat(80))).toBe("x".repeat(40));
  expect(acceptanceAnchor("  前后有空白  \n第二行更长更长更长")).toBe("第二行更长更长更长");
  expect(acceptanceAnchor("'\"`$\\")).toBe("");
});

test("conventionsBacklogTask：内容寻址指纹、来源、严重度、需求含 bullet 原文与验收命令", () => {
  const changes = [conv("约定甲 (C3)"), conv("约定乙 \"引号\" 收尾处的更长片段", "exp-2")];
  const task = conventionsBacklogTask(changes);
  expect(task.source).toBe(CONVENTIONS_BACKLOG_SOURCE);
  expect(task.severity).toBe("error");
  expect(task.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  expect(conventionsBacklogTask([conv("约定甲 (C3)", "other-source"), conv("约定乙 \"引号\" 收尾处的更长片段")]).fingerprint).toBe(task.fingerprint);
  expect(conventionsBacklogTask([conv("约定乙 \"引号\" 收尾处的更长片段"), conv("约定甲 (C3)")]).fingerprint).not.toBe(task.fingerprint);

  expect(task.requirement.startsWith(`${CONVENTIONS_BACKLOG_PREFIX} 追加 2 条已批准的进化约定到 ${CONVENTIONS_TARGET_REL}`)).toBe(true);
  expect(task.requirement).toContain("- 约定甲 (C3)");
  expect(task.requirement).toContain("- 约定乙 \"引号\" 收尾处的更长片段");
  expect(task.requirement).toContain("（源 exp-1）");
  expect(task.requirement).toContain("（源 exp-2）");
  expect(task.requirement).toContain("allow: constitution/conventions.md");
  expect(task.requirement).toContain("forbid: constitution/core.md");
  expect(task.requirement).toContain("forbid: constitution/roles/**");
  expect(task.requirement).toContain("grep -qF -- '约定甲 (C3)' constitution/conventions.md && grep -qF -- '收尾处的更长片段' constitution/conventions.md");
  expect(task.requirement).not.toMatch(/kunpengHome|\/Users\//);
});

test("conventionsBacklogTask：文本两端空白与尾换行被 trim；锚为空的条目不进验收命令", () => {
  const task = conventionsBacklogTask([conv("  折叠的约定\n"), conv("'\"`$\\")]);
  expect(task.requirement).toContain("- 折叠的约定\n");
  expect(task.requirement).toContain("grep -qF -- '折叠的约定' constitution/conventions.md");
  expect(task.requirement).not.toContain("grep -qF -- '' ");
});

test("backlogConventionsApplier：已在约定文件里的进 skipped，其余合成一条 backlog 任务入队，绝不写约定文件", async () => {
  const enqueue = vi.fn(async (_task) => ({ added: ["x"], skipped: [] as string[] }));
  const onEnqueued = vi.fn();
  const apply = backlogConventionsApplier({
    readConventions: async () => "# 可调约定\n- 已存在的约定\n",
    enqueue,
    onEnqueued,
  });
  const res = await apply("/nonexistent/conventions.md", [conv("已存在的约定"), conv("全新约定 A"), conv("全新约定 B")]);
  expect(res.skipped).toEqual(["已存在的约定"]);
  expect(res.appended).toEqual(["全新约定 A", "全新约定 B"]);
  expect(enqueue).toHaveBeenCalledTimes(1);
  const task = enqueue.mock.calls[0]![0];
  expect(task.source).toBe(CONVENTIONS_BACKLOG_SOURCE);
  expect(task.requirement).toContain("- 全新约定 A");
  expect(task.requirement).not.toContain("- 已存在的约定");
  expect(onEnqueued).toHaveBeenCalledWith(task);
});

test("backlogConventionsApplier：全部已存在 → 不入队；指纹已在队列(enqueue 报 skipped) 仍算 appended（幂等交接）", async () => {
  const enqueue = vi.fn(async (_task) => ({ added: [] as string[], skipped: ["dup"] }));
  const apply = backlogConventionsApplier({ readConventions: async () => "- 甲\n", enqueue });
  expect(await apply("/x.md", [conv("甲")])).toEqual({ appended: [], skipped: ["甲"] });
  expect(enqueue).not.toHaveBeenCalled();
  expect(await apply("/x.md", [conv("乙")])).toEqual({ appended: ["乙"], skipped: [] });
  expect(enqueue).toHaveBeenCalledTimes(1);
});

test("backlogConventionsApplier：约定文件读不到时视为空文件，不抛错", async () => {
  const enqueue = vi.fn(async (_task) => ({ added: ["x"], skipped: [] as string[] }));
  const apply = backlogConventionsApplier({ readConventions: async () => { throw new Error("ENOENT"); }, enqueue });
  expect(await apply("/missing.md", [conv("甲")])).toEqual({ appended: ["甲"], skipped: [] });
});

test("conventionsLanded：约定文件含全部合规 conventions 条目才算落地；被质量门拒的条目不计；无条目不算落地", () => {
  const md = "# 可调约定\n- 甲\n- 乙\n";
  expect(conventionsLanded(md, [conv("甲"), conv("乙")])).toBe(true);
  expect(conventionsLanded(md, [conv("甲"), conv("丙")])).toBe(false);
  expect(conventionsLanded(md, [conv("甲"), conv("   ")])).toBe(true);
  expect(conventionsLanded(md, [{ target: "upgrade", text: "丙", source: "e" }, conv("甲")])).toBe(true);
  expect(conventionsLanded(md, [])).toBe(false);
  expect(conventionsLanded(md, [{ target: "constitution/core.md", text: "甲", source: "e" }])).toBe(false);
});