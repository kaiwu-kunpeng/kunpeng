import { describe, expect, it } from "vitest";
import { classifyAcceptOutput, classifyFailureText } from "../../src/loop/rollback-attribution.js";
import { RECURRENCE_HINTS } from "../../src/metrics/rollback-recurrence.js";

// 样本全部取自 .kunpeng/state 里真实 rolled-back 流的 failureReason 家族。
describe("自由文本归因（作者锁定）", () => {
  it("并发碰红：worktree/分支/锁被占", () => {
    expect(classifyFailureText("dev-cycle 异常: Error: Preparing worktree (new branch 'kp/x')\nfatal: 'kp/x' is already checked out at '/Users/x/wt/kp-x'").kind).toBe("worktree-contention");
    expect(classifyFailureText("fatal: Unable to create '/Users/x/.git/index.lock': File exists.\nAnother git process seems to be running").kind).toBe("worktree-contention");
    expect(classifyAcceptOutput("RUN v4.1.10\n × a\nfatal: Unable to create '.git/index.lock': File exists\n Tests 1 failed").kind).toBe("worktree-contention");
  });

  it("审计拒绝 / 放弃 / 判死 / 范围门 / 没先红", () => {
    expect(classifyFailureText("验收测试审计未通过: vitest 命令点名的测试文件不存在: test/x.test.ts").kind).toBe("audit-rejected");
    expect(classifyFailureText("[abandoned] 人工放弃该流；放弃前卡点：卡在 verify").kind).toBe("abandoned");
    expect(classifyFailureText("[retired-superseded] 崩溃流分支 kp/x 已被主干吸收或已不存在，自动退役；崩溃时卡点：主人进程已崩溃（启动时判定）").kind).toBe("crashed");
    expect(classifyFailureText("lease-expired-stuck: 进程 123 存活但 900000ms 无心跳（stall 自 1）").kind).toBe("crashed");
    expect(classifyFailureText("范围门：改动了 allow 之外的文件 src/x.ts").kind).toBe("scope-gate");
    expect(classifyFailureText("验收在实现前已通过（没先红，exit=0）：作者测试没锁住目标").kind).toBe("not-red-first");
  });

  it("其它文本回落到 classifyAcceptOutput 的规则", () => {
    expect(classifyFailureText("项目检查 [cd orchestrator && npm run test:unit] 引入基线之外的新问题:\n × x").kind).toBe("check-regression");
    expect(classifyFailureText("RUN v4.1.10 /Users/x\n × foo\n Tests 1 failed | 3 passed").kind).toBe("test-failed");
    expect(classifyFailureText("src/a.ts(3,5): error TS2322: Type 'x'").kind).toBe("typecheck");
    const unknown = classifyFailureText("something odd happened");
    expect(unknown.kind).toBe("unknown");
    expect(unknown.summary).toBe("something odd happened");
  });

  it("classifyAcceptOutput 其它优先级不变", () => {
    expect(classifyAcceptOutput("Transform failed with 1 error").kind).toBe("transform-error");
    expect(classifyAcceptOutput("命令超时被杀").kind).toBe("timeout");
    expect(classifyAcceptOutput("").kind).toBe("anchor-missing");
  });

  it("复发提示表覆盖新 kind", () => {
    for (const kind of ["worktree-contention", "audit-rejected", "crashed", "abandoned", "scope-gate"]) {
      expect(typeof RECURRENCE_HINTS[kind], kind).toBe("string");
      expect(RECURRENCE_HINTS[kind]!.length, kind).toBeLessThanOrEqual(60);
    }
  });
});