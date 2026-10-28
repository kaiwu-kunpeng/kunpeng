import { describe, expect, test } from "vitest";
import { getAdapter } from "./backend-adapter.js";

describe("codexAdapter --output-schema 接线", () => {
  test("route 带 outputSchemaPath → args 含 --output-schema", () => {
    const inv = getAdapter("codex")!.invoke({ outputSchemaPath: "/tmp/v.json" }, [], undefined);
    expect(inv.args).toContain("--output-schema");
    expect(inv.args).toContain("/tmp/v.json");
  });
  test("无 schema → args 不含 --output-schema", () => {
    const inv = getAdapter("codex")!.invoke({}, [], undefined);
    expect(inv.args).not.toContain("--output-schema");
  });
});
