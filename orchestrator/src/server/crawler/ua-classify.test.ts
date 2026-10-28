import { expect, it } from "vitest";
import { aiBotFromUA } from "./ua-classify.js";

it("识别 ChatGPT-User(被引用最强信号)", () => {
  expect(aiBotFromUA("Mozilla/5.0 ... ChatGPT-User/1.0; +https://openai.com/bot")).toBe("ChatGPT-User");
});

it("识别 GPTBot / ClaudeBot / PerplexityBot", () => {
  expect(aiBotFromUA("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")).toBe("GPTBot");
  expect(aiBotFromUA("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)")).toBe("ClaudeBot");
  expect(aiBotFromUA("Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)")).toBe("PerplexityBot");
});

it("Claude-User 不被 ClaudeBot 误吞(具体串优先)", () => {
  expect(aiBotFromUA("Mozilla/5.0 ... Claude-User/1.0; +https://anthropic.com")).toBe("Claude-User");
});

it("大小写不敏感", () => {
  expect(aiBotFromUA("mozilla/5.0 (compatible; gptbot/1.2)")).toBe("GPTBot");
});

it("普通浏览器 / 空串返回 null", () => {
  expect(aiBotFromUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")).toBeNull();
  expect(aiBotFromUA("")).toBeNull();
});
