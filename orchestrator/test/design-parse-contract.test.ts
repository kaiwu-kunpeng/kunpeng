import { expect, test } from "vitest";
import type { DesignContract } from "../src/design/contract.js";
import { parseDesignContract } from "../src/design/parse-contract.js";

test("parses a valid contract", () => {
  const text = JSON.stringify({
    source: "figma:abc",
    anchor: "shadcn/ui + Geist",
    tokens: {
      colors: { primary: "#111111" },
      spacing: { md: "16px" },
      typography: { body: "Geist 16/24" },
    },
    components: ["Button", "Card"],
  });
  const c = parseDesignContract(text, "claude-native") as DesignContract;
  expect(c.source).toBe("figma:abc");
  expect(c.anchor).toBe("shadcn/ui + Geist");
  expect(c.tokens.colors.primary).toBe("#111111");
  expect(c.tokens.spacing.md).toBe("16px");
  expect(c.tokens.typography.body).toBe("Geist 16/24");
  expect(c.components).toEqual(["Button", "Card"]);
});

test("falls back to fallbackSource when source is missing", () => {
  const text = JSON.stringify({
    anchor: "shadcn/ui",
    components: ["Button"],
  });
  const c = parseDesignContract(text, "claude-native") as DesignContract;
  expect(c.source).toBe("claude-native");
});

test("filters out non-string component elements", () => {
  const text = JSON.stringify({
    anchor: "shadcn/ui",
    components: ["Button", "Card", 42],
  });
  const c = parseDesignContract(text, "claude-native") as DesignContract;
  expect(c.components).toEqual(["Button", "Card"]);
});

test("reads token groups, defaulting missing groups to empty objects", () => {
  const text = JSON.stringify({
    anchor: "shadcn/ui",
    components: ["Button"],
    tokens: { colors: { primary: "#000000" } },
  });
  const c = parseDesignContract(text, "claude-native") as DesignContract;
  expect(c.tokens.colors).toEqual({ primary: "#000000" });
  expect(c.tokens.spacing).toEqual({});
  expect(c.tokens.typography).toEqual({});
});

test("returns null on non-JSON input", () => {
  expect(parseDesignContract("not json", "claude-native")).toBeNull();
});

test("returns null when components is empty", () => {
  const text = JSON.stringify({ anchor: "shadcn/ui", components: [] });
  expect(parseDesignContract(text, "claude-native")).toBeNull();
});

test("returns null when anchor is missing", () => {
  const text = JSON.stringify({ components: ["Button"] });
  expect(parseDesignContract(text, "claude-native")).toBeNull();
});
