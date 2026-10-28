import { expect, test } from "vitest";

import { fetchBrand, isNeutralHex, parseBrandResponse, pickSeedColor } from "../../src/design/brand-import.js";

test("detects neutral hex colors by channel spread", () => {
  expect(isNeutralHex("#1a1a1a")).toBe(true);
  expect(isNeutralHex("#E2620E")).toBe(false);
});

test("picks priority and non-neutral seed colors", () => {
  expect(
    pickSeedColor([
      { hex: "#111", type: "text" },
      { hex: "#E2620E", type: "accent" },
    ]),
  ).toBe("#E2620E");
  expect(pickSeedColor([{ hex: "#222" }, { hex: "#3b82f6" }])).toBe("#3b82f6");
  expect(pickSeedColor({ accent: "#E2620E", background: "#fff" })).toBe("#E2620E");
});

test("parses brand assets from Brandfetch shaped responses", () => {
  expect(
    parseBrandResponse({
      colors: [{ hex: "#E2620E", type: "accent" }],
      fonts: [{ name: "Inter" }],
      logos: [{ formats: [{ src: "https://x/l.svg" }] }],
    }),
  ).toEqual({
    seedHex: "#E2620E",
    fonts: ["Inter"],
    logoUrl: "https://x/l.svg",
    source: undefined,
  });
});

test("parses empty responses without throwing", () => {
  expect(parseBrandResponse({})).toEqual({
    seedHex: undefined,
    fonts: [],
    logoUrl: undefined,
    source: undefined,
  });
});

test("fetchBrand returns null without an api key", async () => {
  delete process.env.BRANDFETCH_API_KEY;
  delete process.env.BRAND_DEV_KEY;

  await expect(fetchBrand("x.com", {})).resolves.toBeNull();
});

test("fetchBrand parses successful injected fetch responses", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        colors: [{ hex: "#E2620E", type: "brand" }],
        fonts: [],
        logos: [],
      }),
      { status: 200 },
    );

  await expect(fetchBrand("x.com", { apiKey: "k", fetchImpl })).resolves.toMatchObject({
    seedHex: "#E2620E",
  });
});
