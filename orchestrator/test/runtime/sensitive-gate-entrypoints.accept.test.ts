import { describe, expect, it } from "vitest";
import { classifySensitiveFiles } from "../../src/runtime/sensitive-paths.js";
import { decideMergeTier } from "../../src/runtime/merge-tiers.js";

// 审计 S-04：鉴权门、鉴权前路由、bypass 拼装、免鉴权 webhook、WS 鉴权、SSRF 闸、loop 门禁组装、派流控制
const GATE_ENTRYPOINTS = [
  "src/server/profile-middleware.ts",
  "src/server/http.ts",
  "src/server/chat-stream.ts",
  "src/server/webhook-endpoints.ts",
  "src/server/pty-endpoint.ts",
  "src/util/ssrf-guard.ts",
  "src/loop/dev-cycle.ts",
  "src/server/routes/run-control.ts",
];

describe("门禁入口文件进敏感清单（作者锁定）", () => {
  it.each(GATE_ENTRYPOINTS.flatMap((file) => [file, `orchestrator/${file}`]))("命中 %s → 守门器源码", (file) => {
    const out = classifySensitiveFiles([file]);
    expect(out.sensitive).toBe(true);
    expect(out.hits.map((hit) => hit.label)).toContain("守门器源码");
  });

  it.each([
    "orchestrator/src/server/ui/views/overview.ts",
    "orchestrator/src/server/http-compress.ts",
    "orchestrator/src/server/chat-sse.ts",
    "orchestrator/src/server/chat-stream-helpers.ts",
    "orchestrator/src/server/pty-pool.ts",
    "orchestrator/src/server/profile-migrate-exec.ts",
    "orchestrator/src/loop/dev-cycle-events.ts",
    "orchestrator/src/server/routes/run-controls.ts",
    "orchestrator/src/util/ssrf-guard.test.ts",
    "orchestrator/test/loop/dev-cycle.test.ts",
    "orchestrator/src/server/http.test.ts",
    "docs/server/http.ts.md",
  ])("不命中 %s（规则不能写宽）", (file) => {
    expect(classifySensitiveFiles([file])).toEqual({ sensitive: false, hits: [] });
  });

  it("只改鉴权中间件的流：合并分级判人审，理由带「守门器源码」", () => {
    const changedFiles = ["orchestrator/src/server/profile-middleware.ts", "orchestrator/test/server/profile-middleware.test.ts"];
    const decision = decideMergeTier({
      flowId: "demo",
      changedFiles,
      sensitiveHits: classifySensitiveFiles(changedFiles).hits,
      publicSurfaceTouched: false,
      redFirst: true,
      changedFileCount: changedFiles.length,
    });
    expect(decision.tier).toBe("human");
    expect(decision.ruleIds).toContain("sensitive-path");
    expect(decision.reasons.join(" ")).toContain("守门器源码");
  });
});