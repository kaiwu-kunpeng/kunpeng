import { describe, it, expect } from "vitest";
import { geoPrompt, parseGeoAnswer } from "./core.js";

// The point of this change is that a wave can later answer "which page of theirs
// got picked". Domains alone cannot; 21 waves proved that. So every case here is
// about the URL surviving intact, and about the domain list staying usable for
// everything already reading it.
// Neutral fixture domains on purpose: this repo is de-tenanted and a guardrail
// test (test/detenant/) fails the whole suite if a customer name appears
// anywhere under src/ or test/. Use example.* here, never a real tenant domain.
const CONFIG = { brandNames: ["ExampleBrand"], brandDomains: ["example.ai"] };

describe("geoPrompt", () => {
  it("asks the engine for page-level URLs, not just domains", () => {
    const prompt = geoPrompt("best esim for china", CONFIG);
    expect(prompt).toContain("citedUrls");
  });
});

describe("parseGeoAnswer with citedUrls", () => {
  it("keeps the full URL and derives the domain from it", () => {
    const answer = parseGeoAnswer(
      "q",
      '{"summary":"s","citedUrls":["https://vendor-one.example/blogs/payments-apps/guide-2026"],"mentionedBrand":false}',
      CONFIG,
    );
    expect(answer.citedUrls).toEqual(["https://vendor-one.example/blogs/payments-apps/guide-2026"]);
    expect(answer.citedDomains).toEqual(["vendor-one.example"]);
  });

  it("strips www when deriving the domain", () => {
    const answer = parseGeoAnswer("q", '{"citedUrls":["https://www.vendor-two.example/news/x"]}', CONFIG);
    expect(answer.citedDomains).toEqual(["vendor-two.example"]);
  });

  it("drops junk: non-strings, non-http schemes, unparseable values, duplicates", () => {
    const answer = parseGeoAnswer(
      "q",
      '{"citedUrls":["https://a.com/1","https://a.com/1",42,"ftp://b.com/x","not a url",null]}',
      CONFIG,
    );
    expect(answer.citedUrls).toEqual(["https://a.com/1"]);
    expect(answer.citedDomains).toEqual(["a.com"]);
  });

  it("still works for the old shape: domains only, no urls", () => {
    const answer = parseGeoAnswer("q", '{"summary":"s","citedDomains":["vendor-three.example"],"mentionedBrand":false}', CONFIG);
    expect(answer.citedDomains).toEqual(["vendor-three.example"]);
    expect(answer.citedUrls).toEqual([]);
    expect(answer.mentioned).toBe(false);
  });

  it("counts a brand citation when the brand appears as a cited URL", () => {
    const answer = parseGeoAnswer("q", '{"citedUrls":["https://www.example.ai/guide/x"]}', CONFIG);
    expect(answer.mentioned).toBe(true);
  });

  // The substring trap the old `domain.includes(brandDomain)` check would fall
  // into: a different site whose host merely contains the brand host.
  it("does not count a lookalike domain as the brand", () => {
    const answer = parseGeoAnswer("q", '{"citedUrls":["https://notexample.ai/esim"]}', CONFIG);
    expect(answer.mentioned).toBe(false);
    expect(answer.citedDomains).toEqual(["notexample.ai"]);
  });

  // A sibling site on another TLD is a different product, not us.
  it("does not count a sibling TLD as the brand", () => {
    const answer = parseGeoAnswer("q", '{"citedUrls":["https://example.com/esim"]}', CONFIG);
    expect(answer.mentioned).toBe(false);
  });

  it("counts a real subdomain of the brand", () => {
    const answer = parseGeoAnswer("q", '{"citedDomains":["blog.example.ai"]}', CONFIG);
    expect(answer.mentioned).toBe(true);
  });

  it("returns empty arrays rather than throwing on unparseable output", () => {
    const answer = parseGeoAnswer("q", "sorry, I cannot answer", CONFIG);
    expect(answer.error).toBe("unparseable");
    expect(answer.citedUrls).toEqual([]);
    expect(answer.citedDomains).toEqual([]);
  });
});