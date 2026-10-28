export type AiBotClass = "training" | "search" | "user";

export interface AiCrawler {
  name: string;
  class: AiBotClass;
  vendor: string;
}

export const AI_CRAWLERS: readonly AiCrawler[] = [
  { name: "GPTBot", class: "training", vendor: "OpenAI" },
  { name: "OAI-SearchBot", class: "search", vendor: "OpenAI" },
  { name: "ChatGPT-User", class: "user", vendor: "OpenAI" },
  { name: "ClaudeBot", class: "training", vendor: "Anthropic" },
  { name: "anthropic-ai", class: "training", vendor: "Anthropic" },
  { name: "Claude-SearchBot", class: "search", vendor: "Anthropic" },
  { name: "Claude-User", class: "user", vendor: "Anthropic" },
  { name: "PerplexityBot", class: "search", vendor: "Perplexity" },
  { name: "Perplexity-User", class: "user", vendor: "Perplexity" },
  { name: "Google-Extended", class: "training", vendor: "Google" },
  { name: "Google-CloudVertexBot", class: "training", vendor: "Google" },
  { name: "Gemini-Deep-Research", class: "user", vendor: "Google" },
  { name: "Google-NotebookLM", class: "user", vendor: "Google" },
  { name: "GoogleAgent-URLContext", class: "user", vendor: "Google" },
  { name: "Applebot-Extended", class: "training", vendor: "Apple" },
  { name: "Meta-ExternalAgent", class: "training", vendor: "Meta" },
  { name: "Meta-ExternalFetcher", class: "user", vendor: "Meta" },
  { name: "Amazonbot", class: "training", vendor: "Amazon" },
  { name: "Amzn-SearchBot", class: "search", vendor: "Amazon" },
  { name: "Amzn-User", class: "user", vendor: "Amazon" },
  { name: "AzureAI-SearchBot", class: "search", vendor: "Microsoft" },
  { name: "CCBot", class: "training", vendor: "Common Crawl" },
  { name: "Bytespider", class: "training", vendor: "ByteDance" },
  { name: "TikTokSpider", class: "training", vendor: "ByteDance" },
  { name: "DoubaoBot", class: "search", vendor: "ByteDance" },
  { name: "MistralAI-Training", class: "training", vendor: "Mistral" },
  { name: "MistralAI-Index", class: "search", vendor: "Mistral" },
  { name: "MistralAI-User", class: "user", vendor: "Mistral" },
  { name: "cohere-training-data-crawler", class: "training", vendor: "Cohere" },
  { name: "cohere-ai", class: "user", vendor: "Cohere" },
  { name: "DeepSeekBot", class: "training", vendor: "DeepSeek" },
  { name: "KimiBot", class: "training", vendor: "Moonshot AI" },
  { name: "Kimi-SearchBot", class: "search", vendor: "Moonshot AI" },
  { name: "Kimi-User", class: "user", vendor: "Moonshot AI" },
  { name: "QwenBot", class: "training", vendor: "Alibaba" },
  { name: "TongyiBot", class: "user", vendor: "Alibaba" },
  { name: "ERNIEBot", class: "training", vendor: "Baidu" },
  { name: "YiyanBot", class: "user", vendor: "Baidu" },
  { name: "ChatGLM-Spider", class: "training", vendor: "Zhipu" },
  { name: "PanguBot", class: "training", vendor: "Huawei" },
  { name: "YouBot", class: "search", vendor: "You.com" },
  { name: "DuckAssistBot", class: "user", vendor: "DuckDuckGo" },
  { name: "PhindBot", class: "user", vendor: "Phind" },
  { name: "kagi-fetcher", class: "user", vendor: "Kagi" },
  { name: "ExaBot", class: "search", vendor: "Exa" },
  { name: "TavilyBot", class: "search", vendor: "Tavily" },
  { name: "LinkupBot", class: "search", vendor: "Linkup" },
  { name: "Bravebot", class: "search", vendor: "Brave" },
  { name: "Manus-User", class: "user", vendor: "Manus" },
  { name: "FirecrawlAgent", class: "user", vendor: "Firecrawl" },
  { name: "Diffbot", class: "training", vendor: "Diffbot" },
  { name: "Timpibot", class: "training", vendor: "Timpi" },
  { name: "AI2Bot", class: "training", vendor: "Ai2" },
  { name: "Ai2Bot-Dolma", class: "training", vendor: "Ai2" },
  { name: "ImagesiftBot", class: "training", vendor: "ImageSift" },
];

const UA_MATCHERS = AI_CRAWLERS.map((crawler) => ({
  crawler,
  pattern: new RegExp(`(?:^|[^a-z0-9])${crawler.name}(?=$|[^a-z0-9-])`, "i"),
})).sort((a, b) => b.crawler.name.length - a.crawler.name.length);

export function aiCrawlerFromUserAgent(ua: unknown): AiCrawler | null {
  if (typeof ua !== "string" || ua.length === 0) return null;
  return UA_MATCHERS.find(({ pattern }) => pattern.test(ua))?.crawler ?? null;
}
