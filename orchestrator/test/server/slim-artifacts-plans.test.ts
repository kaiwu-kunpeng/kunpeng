import { expect, test } from "vitest";
import {
  artifactCounts,
  slimArtifactsForDashboard,
  slimPlansForDashboard,
  type PlanSummary,
  type StateItem,
} from "../../src/server/state.js";

function stateItem(kind: string, index: number): StateItem {
  return {
    id: `${kind}-${index}`,
    kind,
    status: "verified",
    summary: `${kind} summary ${index}`,
  };
}

function plan(index: number): PlanSummary {
  return {
    id: `plan-${index}`,
    status: "verified",
    merged: true,
    desc: `plan ${index}`,
    summary: `plan summary ${index}`,
    segmentCount: index,
  };
}

test("slimArtifactsForDashboard keeps the last 30 artifacts per kind by default", () => {
  const artifacts = {
    experience: Array.from({ length: 50 }, (_, index) => stateItem("experience", index)),
    release: Array.from({ length: 2 }, (_, index) => stateItem("release", index)),
  };
  const original = structuredClone(artifacts);

  const slimmed = slimArtifactsForDashboard(artifacts);

  expect(slimmed).not.toBe(artifacts);
  expect(slimmed.experience).toHaveLength(30);
  expect(slimmed.experience.map((item) => item.id)).toEqual(
    artifacts.experience.slice(-30).map((item) => item.id)
  );
  expect(slimmed.release).toHaveLength(2);
  expect(slimmed.release.map((item) => item.id)).toEqual(["release-0", "release-1"]);
  expect(artifacts).toEqual(original);
});

test("artifactCounts returns full counts for every artifact kind without mutating input", () => {
  const artifacts = {
    experience: Array.from({ length: 50 }, (_, index) => stateItem("experience", index)),
    release: Array.from({ length: 2 }, (_, index) => stateItem("release", index)),
  };
  const original = structuredClone(artifacts);

  const counts = artifactCounts(artifacts);

  expect(counts).toEqual({ experience: 50, release: 2 });
  expect(artifacts).toEqual(original);
});

test("slimPlansForDashboard keeps the last 40 plans by default without mutating input", () => {
  const plans = Array.from({ length: 50 }, (_, index) => plan(index));
  const original = structuredClone(plans);

  const slimmed = slimPlansForDashboard(plans);

  expect(slimmed).toHaveLength(40);
  expect(slimmed.map((item) => item.id)).toEqual(plans.slice(-40).map((item) => item.id));
  expect(plans).toEqual(original);
});

test("slimPlansForDashboard honors custom recentN without mutating input", () => {
  const plans = Array.from({ length: 50 }, (_, index) => plan(index));
  const original = structuredClone(plans);

  const slimmed = slimPlansForDashboard(plans, { recentN: 7 });

  expect(slimmed).toHaveLength(7);
  expect(slimmed.map((item) => item.id)).toEqual(plans.slice(-7).map((item) => item.id));
  expect(plans).toEqual(original);
});
