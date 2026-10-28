import { describe, expect, test } from "vitest";
import { outputSchemaArgs } from "./output-schema.js";

describe("outputSchemaArgs", () => {
  test("with path → flag", () => {
    expect(outputSchemaArgs("/tmp/s.json")).toEqual(["--output-schema", "/tmp/s.json"]);
  });
  test("undefined → empty", () => {
    expect(outputSchemaArgs(undefined)).toEqual([]);
  });
});
