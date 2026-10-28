import { describe, expect, test } from "vitest";
import { CliRunner } from "../../src/agent/cli-runner.js";
import { claudeAdapter, codexAdapter } from "../../src/agent/backend-adapter.js";
import { AgentResearcher } from "../../src/research/researcher.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";

/** 抓住 researcher 真正发出去的那个请求。 */
class CaptureRunner implements AgentRunner {
  seen: AgentRequest | null = null;
  constructor(private reply: string) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    this.seen = req;
    return { text: this.reply, meta: {} };
  }
}

describe("instructionOverride 顶掉 stage 角色", () => {
  test("有 override:整段换掉,既无 TESTCMD 也无 # Stage 行", () => {
    const r = new CliRunner({ backend: "codex" });
    const p = r.buildPrompt({
      stage: "spec", system: "rules", input: "调研 X", tools: [],
      instructionOverride: "联网调研并只返回 JSON 数组",
    });
    expect(p).toContain("联网调研并只返回 JSON 数组");
    expect(p).toContain("调研 X");
    expect(p).toContain("rules");
    expect(p).not.toContain("TESTCMD");
    expect(p).not.toContain("# Stage:");
  });

  test("空串 override 视同没有:spec 角色照旧生效", () => {
    const r = new CliRunner({ backend: "codex" });
    const p = r.buildPrompt({
      stage: "spec", system: "", input: "do x", tools: [], instructionOverride: "",
    });
    expect(p).toContain("TESTCMD");
    expect(p).toContain("# Stage: spec");
  });

  test("反向:无 override 的 spec 阶段仍要 TESTCMD(既有行为零回归)", () => {
    const r = new CliRunner({ backend: "codex" });
    const p = r.buildPrompt({ stage: "spec", system: "rules", input: "do x", tools: [] });
    expect(p).toContain("TESTCMD");
    expect(p).toContain("# Stage: spec");
    expect(p).toContain("do x");
  });

  test("反向:无 override 的 implement 阶段仍不给 TESTCMD(C3)", () => {
    const r = new CliRunner({ backend: "codex" });
    const p = r.buildPrompt({ stage: "implement", system: "", input: "do x", tools: [] });
    expect(p).not.toContain("TESTCMD");
    expect(p).toContain("# Stage: implement");
  });
});

describe("codex 也能上网", () => {
  test("tools 含 websearch → 注入 -c tools.web_search=true", () => {
    const inv = codexAdapter.invoke({}, ["websearch"]);
    const i = inv.args.indexOf("tools.web_search=true");
    expect(i, "必须出现 tools.web_search=true").toBeGreaterThan(0);
    expect(inv.args[i - 1], "必须由 -c 引导").toBe("-c");
  });

  test("tools 含 webfetch 变体也算(与 wantsWeb 口径一致)", () => {
    expect(codexAdapter.invoke({}, ["WebFetch"]).args).toContain("tools.web_search=true");
  });

  test("反向:tools 不含 web 时绝不注入", () => {
    expect(codexAdapter.invoke({}, []).args).not.toContain("tools.web_search=true");
    expect(codexAdapter.invoke({}, ["bash"]).args).not.toContain("tools.web_search=true");
  });

  test("无回归:codex 原有参数还在", () => {
    const inv = codexAdapter.invoke({ effort: "low" }, ["websearch"]);
    expect(inv.args[0]).toBe("exec");
    expect(inv.args).toContain("--json");
    expect(inv.args).toContain("--skip-git-repo-check");
    expect(inv.args.join(" ")).toContain("model_reasoning_effort=low");
    expect(inv.promptVia).toBe("stdin");
  });

  test("无回归:claude 的 --allowedTools 行为不变", () => {
    expect(claudeAdapter.invoke({}, ["websearch"]).args).toContain("--allowedTools");
    expect(claudeAdapter.invoke({}, []).args).not.toContain("--allowedTools");
  });
});

describe("researcher 真的把 override 传下去了", () => {
  test("发出的请求带 instructionOverride,且申明不是写 spec", async () => {
    const runner = new CaptureRunner("[]");
    await new AgentResearcher(runner).research("AGENTS.md 配置标准");
    const req = runner.seen;
    expect(req, "必须发出过请求").not.toBeNull();
    expect(typeof req!.instructionOverride).toBe("string");
    expect(req!.instructionOverride!.length).toBeGreaterThan(0);
    expect(req!.instructionOverride).toContain("不是产出 spec");
    expect(req!.instructionOverride).toContain("不要输出验收标准");
    expect(req!.instructionOverride, "指令本身不许带 TESTCMD 字样").not.toContain("TESTCMD");
    expect(req!.tools).toContain("websearch");
    expect(req!.input).toContain("AGENTS.md 配置标准");
    expect(req!.input).toContain("只输出 JSON 数组本身");
  });

  test("端到端:researcher 的请求过 buildPrompt 后,最终 prompt 不含 TESTCMD", async () => {
    const runner = new CaptureRunner("[]");
    await new AgentResearcher(runner).research("多 agent 编排");
    const prompt = new CliRunner({ backend: "codex" }).buildPrompt(runner.seen!);
    expect(prompt).not.toContain("TESTCMD");
    expect(prompt).not.toContain("产出 spec（含明确");
    expect(prompt).toContain("多 agent 编排");
  });

  test("无回归:解析逻辑没被动,合法 JSON 仍能解析", async () => {
    const runner = new CaptureRunner(
      JSON.stringify([{ topic: "t", source: "https://agents.md/", summary: "s" }]),
    );
    const findings = await new AgentResearcher(runner).research("t");
    expect(findings).toHaveLength(1);
    expect(findings[0].source).toBe("https://agents.md/");
  });
});