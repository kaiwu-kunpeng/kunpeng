import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("SSE 断线区分（治'出错无感知'另一半）", () => {
  test("clientScript 语法有效（防 SPA 静默崩）", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("openStream 用 ended 标志区分正常结束与断线", () => {
    expect(clientScript).toContain("var ended = false");
    // end 事件标记 ended 并以非错误收口
    expect(clientScript).toMatch(/ended = true;\s*cleanup\(\);\s*if \(onDone\) onDone\(false\)/);
  });

  test("onerror 未正常结束时渲染错误并以 errored 收口", () => {
    expect(clientScript).toContain("if (ended) { cleanup(); return; }");
    expect(clientScript).toContain("连接中断");
    expect(clientScript).toContain("onDone(true)");
  });

  test("调用处把 errored 透传给 endRun（断线显示已中断而非完成）", () => {
    expect(clientScript).toMatch(/function \(errored\) \{ endRun\(!!errored\)/);
  });
});