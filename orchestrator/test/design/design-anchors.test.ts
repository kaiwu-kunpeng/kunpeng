import { expect, test } from "vitest";

import { ANCHORS, anchorNames, describeAnchor, getAnchor } from "../../src/design/design-anchors.js";

const chromaValues = new Set(["muted", "balanced", "vivid"]);

test("lists the 8 locked style anchors", () => {
  const names = anchorNames();

  expect(names).toHaveLength(8);
  for (const name of ["Swiss", "Organic", "Brutalist", "Retro-Futuristic", "Lo-Fi"]) {
    expect(names).toContain(name);
  }
});

test("each anchor locks fonts, radius, motion, material, and chroma", () => {
  for (const anchor of Object.values(ANCHORS)) {
    expect(anchor.fontPair.display).not.toHaveLength(0);
    expect(anchor.fontPair.body).not.toHaveLength(0);
    expect(anchor.material).not.toHaveLength(0);
    expect(anchor.radius).toBeGreaterThanOrEqual(0);
    expect(anchor.motionMs).toBeGreaterThanOrEqual(120);
    expect(anchor.motionMs).toBeLessThanOrEqual(300);
    expect(chromaValues.has(anchor.chroma)).toBe(true);
  }
});

test("finds anchors case-insensitively", () => {
  expect(getAnchor("swiss")?.name).toBe("Swiss");
  expect(getAnchor("无")).toBeUndefined();
});

test("describes anchors as a single locked prompt line", () => {
  const description = describeAnchor(getAnchor("Swiss")!);

  expect(description).toContain("Swiss");
  expect(description).toContain("Inter Tight");
  expect(description).toContain("4px");
  expect(description).toContain("180");
  expect(description).toContain("混搭");
});
