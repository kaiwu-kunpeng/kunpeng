import { describe, expect, test } from "vitest";
import * as executionBackend from "../../src/agent/execution-backend.js";
import * as outputSchema from "../../src/agent/output-schema.js";
import * as autoDefine from "../../src/product/auto-define.js";

describe("只被测试引用、已被取代的导出已删除（2026-09-24 死导出盘点，作者锁定）", () => {
  test("resolveExecutionBackend 已删（执行后端改由 flow-options 的 execBackend 配置），其余导出仍在", () => {
    expect("resolveExecutionBackend" in executionBackend).toBe(false);
    expect(typeof executionBackend.selectExecutionKind).toBe("function");
    expect(typeof executionBackend.LocalExecutionBackend).toBe("function");
  });

  test("SPEC_VERDICT_SCHEMA / parseSpecVerdict 已删（结构化裁决从未接线），outputSchemaArgs 仍在且行为不变", () => {
    expect("SPEC_VERDICT_SCHEMA" in outputSchema).toBe(false);
    expect("parseSpecVerdict" in outputSchema).toBe(false);
    expect(outputSchema.outputSchemaArgs("/tmp/s.json")).toEqual(["--output-schema", "/tmp/s.json"]);
    expect(outputSchema.outputSchemaArgs(undefined)).toEqual([]);
  });

  test("autoDefineProduct 的两个无人调用的别名已删，本体仍在", () => {
    expect("autoDefineFromIdea" in autoDefine).toBe(false);
    expect("defineProductFromIdea" in autoDefine).toBe(false);
    expect(typeof autoDefine.autoDefineProduct).toBe("function");
  });
});