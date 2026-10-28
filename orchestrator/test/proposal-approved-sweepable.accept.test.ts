import { describe, expect, it } from "vitest";
import { isProposalRouteTerminalStatus } from "../src/cli.js";

describe("批而未做的提案应可扫(作者验收)", () => {
  it("approved / rolled-back 不是终态(要进管道)", () => {
    expect(isProposalRouteTerminalStatus(undefined, "approved")).toBe(false);
    expect(isProposalRouteTerminalStatus(undefined, "rolled-back")).toBe(false);
  });

  it("verified / rejected / discarded 是终态", () => {
    expect(isProposalRouteTerminalStatus(undefined, "verified")).toBe(true);
    expect(isProposalRouteTerminalStatus(undefined, "rejected")).toBe(true);
    expect(isProposalRouteTerminalStatus(undefined, "discarded")).toBe(true);
  });

  it("meta 路由状态优先:已被管道处理过的不重复", () => {
    expect(isProposalRouteTerminalStatus("auto-enqueued", "approved")).toBe(true);
    expect(isProposalRouteTerminalStatus("auto-rejected", "approved")).toBe(true);
    expect(isProposalRouteTerminalStatus("human-review", "approved")).toBe(true);
  });
});