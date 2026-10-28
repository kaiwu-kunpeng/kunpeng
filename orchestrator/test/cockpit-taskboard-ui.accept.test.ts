import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { renderTaskBoardPanel, renderTasks } from "../src/server/ui/views/tasks.js";

const clientSrc = clientSource();

describe("cockpit 协作队列(作者验收)", () => {
  it("面板渲染带容器与表单", () => {
    const html = renderTaskBoardPanel();
    expect(html).toContain("data-taskboard");
    expect(html).toContain("data-taskboard-list");
    expect(html).toContain("data-taskboard-create");
    expect(html.includes("协作队列")).toBe(true);
  });
  it("renderTasks 拼接了协作队列面板", () => {
    expect(renderTasks([]).includes("data-taskboard")).toBe(true);
  });
  it("client 走三端点且有认领/完成/回收", () => {
    expect(clientSrc).toContain("/api/taskboard/claim");
    expect(clientSrc).toContain("/api/taskboard/complete");
    expect(clientSrc).toContain("/api/taskboard/reap");
    expect(clientSrc.includes("暂无协作任务") || clientSrc.includes("\\u6682\\u65E0\\u534F\\u4F5C\\u4EFB\\u52A1")).toBe(true);
  });
});
