import { expect, test } from "vitest";
import type {
  DesignTokens,
  DesignContract,
  ProjectDesignConfig,
  DesignSourceInput,
  DesignSource,
  DesignCandidate,
} from "../src/design/contract.js";
import { summarizeContract } from "../src/design/contract.js";

const c: DesignContract = {
  source: "house:neutral",
  anchor: "shadcn/ui + Geist",
  tokens: {
    colors: { primary: "#111111", background: "#ffffff" },
    spacing: { md: "16px" },
    typography: { body: "Geist 16/24" },
  },
  components: ["Button", "Card"],
};

test("summarizeContract counts tokens across the three groups and component count", () => {
  // N = 2 colors + 1 spacing + 1 typography = 4 ; M = Button, Card = 2
  expect(summarizeContract(c)).toBe("house:neutral · shadcn/ui + Geist · 4 tokens · 2 组件");
});

test("contract types are usable as type annotations", () => {
  const tokens: DesignTokens = c.tokens;
  const config: ProjectDesignConfig = { source: c.source, anchor: c.anchor, contract: c };
  const input: DesignSourceInput = { kind: "house", ref: "neutral" };
  const candidate: DesignCandidate = { source: c.source, contract: c };
  const source: DesignSource = {
    name: "house",
    resolve: async (_in: DesignSourceInput) => candidate,
  };

  expect(Object.keys(tokens.colors).length).toBe(2);
  expect(config.contract).toBe(c);
  expect(input.kind).toBe("house");
  expect(source.name).toBe("house");
});
