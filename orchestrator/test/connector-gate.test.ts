import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { proposeConnectorAction } from "../src/security/connector-gate.js";
import type { ActionContext } from "../src/security/rule-of-two.js";

let dir: string;
let store: ArtifactStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-connector-gate-"));
  store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("proposes a draft connector artifact when all three risky dimensions are present", async () => {
  const ctx: ActionContext = {
    untrustedInput: true,
    sensitiveAccess: true,
    externalEgress: true,
  };

  const result = await proposeConnectorAction(store, {
    id: "conn-1",
    name: "调用退款 connector",
    ctx,
  });

  expect(result.gated).toBe(true);
  expect(result.artifactId).toBe("conn-1");
  expect(result.verdict.requiresHumanGate).toBe(true);

  const artifact = await store.read("conn-1");
  expect(artifact.kind).toBe("connector");
  expect(artifact.status).toBe("draft");
  expect(artifact.body).toContain("调用退款 connector");
  expect(artifact.meta.verdict).toBeTruthy();
});

test("does not write an artifact when only two risky dimensions are present", async () => {
  const ctx: ActionContext = {
    untrustedInput: true,
    sensitiveAccess: true,
    externalEgress: false,
  };

  const result = await proposeConnectorAction(store, {
    id: "conn-1",
    name: "调用退款 connector",
    ctx,
  });

  expect(result.gated).toBe(false);
  expect(result).not.toHaveProperty("artifactId");

  const artifacts = await store.list();
  expect(artifacts.find((artifact) => artifact.id === "conn-1")).toBeUndefined();
});
