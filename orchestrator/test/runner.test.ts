import { expect, test } from "vitest";
import { FakeRunner } from "../src/agent/runner.js";

test("FakeRunner returns scripted result for a stage", async () => {
  const fake = new FakeRunner({
    spec: { text: "## acceptance\n- X works", meta: { ok: true } },
  });
  const r = await fake.run({ stage: "spec", system: "", input: "build X", tools: [] });
  expect(r.text).toContain("X works");
  expect(r.meta).toEqual({ ok: true });
});

test("FakeRunner throws for an unscripted stage", async () => {
  const fake = new FakeRunner({});
  await expect(fake.run({ stage: "implement", system: "", input: "", tools: [] }))
    .rejects.toThrow(/no scripted result/);
});
