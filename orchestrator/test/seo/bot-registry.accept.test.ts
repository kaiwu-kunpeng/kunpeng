import { describe, expect, test } from "vitest";
import { AI_CRAWLERS, aiCrawlerFromUserAgent, type AiBotClass } from "../../src/seo/bot-registry.js";
import { aiBotFromUA } from "../../src/server/crawler/ua-classify.js";
import { AI_BOT_CLASSES } from "../../src/seo/gates/robots-classes.js";

const EXPECTED: Array<[string, AiBotClass, string]> = [
  ["GPTBot", "training", "OpenAI"],
  ["OAI-SearchBot", "search", "OpenAI"],
  ["ChatGPT-User", "user", "OpenAI"],
  ["ClaudeBot", "training", "Anthropic"],
  ["anthropic-ai", "training", "Anthropic"],
  ["Claude-SearchBot", "search", "Anthropic"],
  ["Claude-User", "user", "Anthropic"],
  ["PerplexityBot", "search", "Perplexity"],
  ["Perplexity-User", "user", "Perplexity"],
  ["Google-Extended", "training", "Google"],
  ["Google-CloudVertexBot", "training", "Google"],
  ["Gemini-Deep-Research", "user", "Google"],
  ["Google-NotebookLM", "user", "Google"],
  ["GoogleAgent-URLContext", "user", "Google"],
  ["Applebot-Extended", "training", "Apple"],
  ["Meta-ExternalAgent", "training", "Meta"],
  ["Meta-ExternalFetcher", "user", "Meta"],
  ["Amazonbot", "training", "Amazon"],
  ["Amzn-SearchBot", "search", "Amazon"],
  ["Amzn-User", "user", "Amazon"],
  ["AzureAI-SearchBot", "search", "Microsoft"],
  ["CCBot", "training", "Common Crawl"],
  ["Bytespider", "training", "ByteDance"],
  ["TikTokSpider", "training", "ByteDance"],
  ["DoubaoBot", "search", "ByteDance"],
  ["MistralAI-Training", "training", "Mistral"],
  ["MistralAI-Index", "search", "Mistral"],
  ["MistralAI-User", "user", "Mistral"],
  ["cohere-training-data-crawler", "training", "Cohere"],
  ["cohere-ai", "user", "Cohere"],
  ["DeepSeekBot", "training", "DeepSeek"],
  ["KimiBot", "training", "Moonshot AI"],
  ["Kimi-SearchBot", "search", "Moonshot AI"],
  ["Kimi-User", "user", "Moonshot AI"],
  ["QwenBot", "training", "Alibaba"],
  ["TongyiBot", "user", "Alibaba"],
  ["ERNIEBot", "training", "Baidu"],
  ["YiyanBot", "user", "Baidu"],
  ["ChatGLM-Spider", "training", "Zhipu"],
  ["PanguBot", "training", "Huawei"],
  ["YouBot", "search", "You.com"],
  ["DuckAssistBot", "user", "DuckDuckGo"],
  ["PhindBot", "user", "Phind"],
  ["kagi-fetcher", "user", "Kagi"],
  ["ExaBot", "search", "Exa"],
  ["TavilyBot", "search", "Tavily"],
  ["LinkupBot", "search", "Linkup"],
  ["Bravebot", "search", "Brave"],
  ["Manus-User", "user", "Manus"],
  ["FirecrawlAgent", "user", "Firecrawl"],
  ["Diffbot", "training", "Diffbot"],
  ["Timpibot", "training", "Timpi"],
  ["AI2Bot", "training", "Ai2"],
  ["Ai2Bot-Dolma", "training", "Ai2"],
  ["ImagesiftBot", "training", "ImageSift"],
];

const ua = (token: string) => `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ${token}/1.0; +https://example.com/bot)`;

describe("AI 爬虫单一登记表（作者锁定）", () => {
  test("登记表内容与 EXPECTED 完全一致", () => {
    const got = AI_CRAWLERS.map((c) => [c.name, c.class, c.vendor].join("|")).sort();
    const want = EXPECTED.map((e) => e.join("|")).sort();
    expect(got).toEqual(want);
    expect(new Set(AI_CRAWLERS.map((c) => c.name.toLowerCase())).size).toBe(AI_CRAWLERS.length);
  });

  test("每个登记名都能从标准形态的 UA 里认出来，分类正确", () => {
    for (const [name, cls] of EXPECTED) {
      expect(aiCrawlerFromUserAgent(ua(name))?.name, name).toBe(name);
      expect(aiCrawlerFromUserAgent(ua(name))?.class, name).toBe(cls);
      expect(aiBotFromUA(ua(name)), name).toBe(name);
    }
  });

  test("独立记号：不吞更长的名字、不在别的词里误报", () => {
    expect(aiCrawlerFromUserAgent(ua("Ai2Bot-Dolma"))?.name).toBe("Ai2Bot-Dolma");
    expect(aiCrawlerFromUserAgent(ua("Claude-User"))?.name).toBe("Claude-User");
    expect(aiCrawlerFromUserAgent(ua("Hexabot"))).toBeNull();
    expect(aiCrawlerFromUserAgent(ua("SuperGPTBotX"))).toBeNull();
    expect(aiCrawlerFromUserAgent(ua("MyYouBot"))).toBeNull();
    expect(aiCrawlerFromUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBeNull();
    expect(aiCrawlerFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBeNull();
    expect(aiCrawlerFromUserAgent("")).toBeNull();
    expect(aiCrawlerFromUserAgent("Mozilla/5.0 (compatible;_GPTBot_/1.0)")?.name).toBe("GPTBot");
    expect(aiCrawlerFromUserAgent("Mozilla/5.0 éGPTBotü")?.name).toBe("GPTBot");
    expect(aiCrawlerFromUserAgent("Mozilla/5.0 GPTBot-Plus/1.0")).toBeNull();
    expect(aiCrawlerFromUserAgent("mozilla/5.0 (compatible; claude-searchbot/1.0)")?.name).toBe("Claude-SearchBot");
    expect(aiCrawlerFromUserAgent("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)")?.name).toBe("ClaudeBot");
  });

  test("robots 报告名单里的 AI 爬虫都在登记表里，且分类一致", () => {
    const byName = new Map(AI_CRAWLERS.map((c) => [c.name.toLowerCase(), c]));
    const traditional = new Set(["Googlebot", "Bingbot", "Applebot", "DuckDuckBot", "YandexBot"]);
    for (const entry of AI_BOT_CLASSES) {
      if (traditional.has(entry.agent)) continue;
      const hit = byName.get(entry.agent.toLowerCase());
      expect(hit, entry.agent).toBeDefined();
      expect(hit!.class, entry.agent).toBe(entry.class);
    }
  });
});