import { describe, it, expect } from "vitest";
import "../../src/cli-commands/product.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

describe("product 命令析出到 CLI 注册表", () => {
  it("注册了 product", () => {
    expect(listCliCommands().some((c) => c.name === "product")).toBe(true);
  });
});