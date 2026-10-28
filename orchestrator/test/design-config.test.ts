import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDesignConfig } from "../src/design/contract.js";
import { readDesignConfig, writeDesignConfig } from "../src/project/design-config.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-design-config-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const design: ProjectDesignConfig = {
  source: "house:neutral",
  anchor: "shadcn/ui + Geist",
  contract: {
    source: "house:neutral",
    anchor: "shadcn/ui + Geist",
    tokens: {
      colors: { primary: "#111111", background: "#ffffff" },
      spacing: { md: "16px" },
      typography: { body: "Geist 16/24" },
    },
    components: ["Button", "Card"],
  },
};

test("write then read roundtrips the design config", async () => {
  await writeDesignConfig(repo, design);
  expect(await readDesignConfig(repo)).toEqual(design);
});

test("read returns undefined when there is no design field", async () => {
  mkdirSync(join(repo, ".kunpeng"), { recursive: true });
  writeFileSync(
    join(repo, ".kunpeng", "project.json"),
    JSON.stringify({ id: "acme", name: "Acme", registeredAt: 1 }, null, 2),
    "utf8",
  );
  expect(await readDesignConfig(repo)).toBeUndefined();
});

test("read returns undefined when project.json is absent", async () => {
  expect(await readDesignConfig(repo)).toBeUndefined();
});

test("write preserves other fields like id", async () => {
  mkdirSync(join(repo, ".kunpeng"), { recursive: true });
  writeFileSync(
    join(repo, ".kunpeng", "project.json"),
    JSON.stringify({ id: "acme", name: "Acme", registeredAt: 1 }, null, 2),
    "utf8",
  );
  await writeDesignConfig(repo, design);

  const raw = JSON.parse(readFileSync(join(repo, ".kunpeng", "project.json"), "utf8"));
  expect(raw.id).toBe("acme");
  expect(await readDesignConfig(repo)).toEqual(design);
});
