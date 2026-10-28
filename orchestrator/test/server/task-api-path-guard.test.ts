import { describe, expect, it } from "vitest";
import { handleTaskTransition } from "../../src/server/task-api.js";

describe("任务流转 API 路径守卫", () => {
  it("穿越任务 id 直接返回 400", async () => {
    const result = await handleTaskTransition({ id: "../x", to: "ready" }, "/unused");

    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain("非法任务 id");
  });
});
