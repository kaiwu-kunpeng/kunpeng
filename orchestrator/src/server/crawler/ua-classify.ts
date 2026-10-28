import { aiCrawlerFromUserAgent } from "../../seo/bot-registry.js";

export function aiBotFromUA(ua: string): string | null {
  return aiCrawlerFromUserAgent(ua)?.name ?? null;
}
