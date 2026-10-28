import { describe, it, expect } from "vitest";
import { isExecAllowedForRole } from "../../src/server/workspace-endpoints.js";

describe("isExecAllowedForRole — exec owner-only(H3)", () => {
  it("owner 放行", () => { expect(isExecAllowedForRole("owner")).toBe(true); });
  it("本地无鉴权(role undefined)放行", () => { expect(isExecAllowedForRole(undefined)).toBe(true); });
  it("member 拒绝(不得 RCE)", () => { expect(isExecAllowedForRole("member")).toBe(false); });
});