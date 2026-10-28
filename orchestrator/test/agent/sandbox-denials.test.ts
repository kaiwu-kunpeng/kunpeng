import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countSandboxDenials } from "../../src/agent/sandbox-signal.js";

// 真机探针原样：codex --json 在 workspace-write 下写 $HOME 的一行 item.completed。
const DENIED_LINE = '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \'touch /Users/u/kp-probe && echo OUTSIDE_OK\'","aggregated_output":"touch: /Users/u/kp-probe: Operation not permitted\\n","exit_code":1,"status":"completed"}}';
const OK_LINE = '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc \'touch ./inside-ok && echo INSIDE_OK\'","aggregated_output":"INSIDE_OK\\n","exit_code":0,"status":"completed"}}';

describe("安全5 沙箱拒绝计数（作者锁定）", () => {
  it("按 Operation not permitted 计数;成功命令与空输入为 0", () => {
    expect(countSandboxDenials(DENIED_LINE)).toBe(1);
    expect(countSandboxDenials([OK_LINE, DENIED_LINE, DENIED_LINE].join("\n"))).toBe(2);
    expect(countSandboxDenials(OK_LINE)).toBe(0);
    expect(countSandboxDenials("")).toBe(0);
    expect(countSandboxDenials("operation NOT permitted")).toBe(0);
  });

  it("cli-runner 两条结果组装路径都接了计数并写 meta.sandboxDenials", () => {
    const src = readFileSync(new URL("../../src/agent/cli-runner.ts", import.meta.url), "utf8");
    expect((src.match(/countSandboxDenials\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("sandboxDenials");
    expect(src).toContain("沙箱拒绝");
  });
});