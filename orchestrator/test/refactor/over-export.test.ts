import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// 作者锁定:每条 [相对路径, 符号] 必须「符号还在」且「声明行不再 export」。
const CASES: [string, string][] = [
  ["src/design/design-presets.ts", "extractSeedHex"],
  ["src/design/knowledge.ts", "STYLES"],
  ["src/design/knowledge.ts", "PALETTES"],
  ["src/design/knowledge.ts", "FONT_PAIRS"],
  ["src/web2mcp/types.ts", "ParamTypeSchema"],
  ["src/web2mcp/types.ts", "ParamLocationSchema"],
  ["src/web2mcp/types.ts", "ActionKindSchema"],
  ["src/web2mcp/types.ts", "ActionTargetSchema"],
  ["src/evolution/apply.ts", "APPROVED"],
  ["src/evolution/apply.ts", "VERIFIED"],
  ["src/server/push.ts", "derToJose"],
  ["src/server/push.ts", "pushToAll"],
  ["src/design/design-render-review.ts", "isNeutral"],
  ["src/design/design-render-review.ts", "oklabDist"],
  ["src/library/scan.ts", "scanDocs"],
  ["src/library/scan.ts", "scanSkills"],
  ["src/library/scan.ts", "scanCaptures"],
  ["src/runtime/merge-review.ts", "isTestPath"],
  ["src/switchboard/task.ts", "TERMINAL_STATES"],
  ["src/agent/cli-runner.ts", "DEFAULT_STREAM_IDLE_TIMEOUT_MS"],
  ["src/server/state-cost-aggregates.ts", "chatTokenTotal"],
  ["src/server/state-cost-aggregates.ts", "readChatConversationsSync"],
  ["src/server/state-cost-aggregates.ts", "readChatCostRollup"],
  ["src/server/view-state.ts", "safeListSkills"],
  ["src/server/view-state.ts", "safeListTemplates"],
  ["src/server/view-state.ts", "safeBuildDocs"],
  ["src/agent/model-routing.ts", "CODEX_TIER_V2"],
  ["src/chat/kb-extract.ts", "URL_RE"],
  ["src/design/headless-shot.ts", "CHROME_CANDIDATES"],
  ["src/evolution/policy.ts", "FORBIDDEN_PLAN_REFS"],
  ["src/feedback/finding-to-task.ts", "SEVERITY_RANK"],
  ["src/feedback/finding-to-task.ts", "normalizeMessage"],
  ["src/loop/dispatch-intent.ts", "DISPATCH_LABEL"],
  ["src/loop/dispatch-intent.ts", "DISPATCH_MARKER"],
  ["src/loop/ops-guard.ts", "SENSITIVE_WAVE_PATTERNS"],
  ["src/metrics/metrics.ts", "GATE_KINDS"],
  ["src/server/read-body.ts", "DEFAULT_MAX_BODY_BYTES"],
  ["src/server/routes/plugins-page.ts", "collectPluginsPageData"],
  ["src/web2mcp/page-provider.ts", "PlaywrightPageProvider"],
  ["src/loop/agent-playbook.ts", "agentPlaybookRecipe"],
  ["src/loop/geo-monitor.ts", "geoMonitorRecipe"],
  ["src/loop/guardian.ts", "runScanner"],
  ["src/loop/types.ts", "LeverSchema"],
  ["src/loop/wechat-capture.ts", "wechatCaptureRecipe"],
  ["src/product/estimate.ts", "DEFAULT_VELOCITY_RATIOS"],
  ["src/runtime/notify.ts", "NOTIFY_TIMEOUT_MS"],
  ["src/server/authz.ts", "ACCOUNT_ADMIN_PREFIX"],
  ["src/server/chat-persistence.ts", "sessionKey"],
  ["src/server/state-title-helpers.ts", "fileStem"],
  ["src/server/ui/views/knowledge.ts", "cleanKnowledgeTitle"],
  ["src/task/model.ts", "TaskStatusSchema"],
];

describe("过度导出收敛", () => {
  it.each(CASES)("%s 的 %s 变为文件私有且未被删除", (rel, name) => {
    const text = readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
    const decl = new RegExp(`^(export\\s+)?(?:declare\\s+)?(?:async\\s+)?(function|const|let|class)\\s+${name}\\b`, "m");
    const m = text.match(decl);
    expect(m, `${rel} 里找不到 ${name} 的声明(不许删符号)`).not.toBeNull();
    expect(m![1], `${rel} 的 ${name} 仍然是 export`).toBeUndefined();
  });

  it("清单本身非空且规模符合预期", () => {
    expect(CASES.length).toBe(51);
  });
});
