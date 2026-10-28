import { clientSource } from "../helpers/client-source.js";
import { describe, it, expect } from "vitest";

describe("Cmd+K 加产品跳转", () => {
  const src = clientSource();
  it("openPalette 含 产品 跳转项指向 /product 路由", () => {
    expect(src).toContain("产品 · ");
    expect(src).toMatch(/"\/product"/);
  });
  it("仍保留 Project 跳转(未破坏既有)", () => {
    expect(src).toContain('commandItem("Project " + project.name');
  });
});