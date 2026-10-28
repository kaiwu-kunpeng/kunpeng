import { expect, test } from "vitest";
import { buildPerfProfile, type PerfSample } from "../../src/perf/perf-sample.js";

test("builds a default ms profile with totals and descending bottlenecks", () => {
  const samples: PerfSample[] = [
    { label: "build", ms: 100 },
    { label: "test", ms: 300 },
    { label: "bundle", ms: 200 },
  ];

  const profile = buildPerfProfile(samples);

  expect(profile.totalMs).toBe(600);
  expect(profile.bottlenecks.map((sample) => sample.ms)).toEqual([300, 200, 100]);
  expect(profile.bottlenecks[0]?.ms).toBe(300);
});

test("sorts bottlenecks by bytes and totals bytes when requested", () => {
  const samples: PerfSample[] = [
    { label: "api", ms: 20, bytes: 4_000 },
    { label: "image", ms: 10, bytes: 25_000 },
    { label: "script", ms: 15, bytes: 12_000 },
  ];

  const profile = buildPerfProfile(samples, { by: "bytes" });

  expect(profile.totalBytes).toBe(41_000);
  expect(profile.bottlenecks.map((sample) => sample.label)).toEqual(["image", "script", "api"]);
});

test("limits bottlenecks by topN", () => {
  const samples: PerfSample[] = [
    { label: "a", ms: 100 },
    { label: "b", ms: 300 },
    { label: "c", ms: 200 },
  ];

  const profile = buildPerfProfile(samples, { topN: 2 });

  expect(profile.bottlenecks).toHaveLength(2);
  expect(profile.bottlenecks.map((sample) => sample.label)).toEqual(["b", "c"]);
});

test("treats omitted fields as zero", () => {
  const samples: PerfSample[] = [{ label: "only-ms", ms: 125 }];

  const profile = buildPerfProfile(samples, { by: "bytes" });

  expect(profile.totalMs).toBe(125);
  expect(profile.totalBytes).toBe(0);
  expect(profile.bottlenecks).toEqual(samples);
});

test("does not mutate input array or sample objects and returns a shallow samples copy", () => {
  const first: PerfSample = { label: "first", ms: 100, bytes: 1_000 };
  const second: PerfSample = { label: "second", ms: 100, bytes: 2_000 };
  const third: PerfSample = { label: "third", ms: 50, bytes: 3_000 };
  const samples = [first, second, third];
  const before = samples.map((sample) => ({ ...sample }));

  const profile = buildPerfProfile(samples);

  expect(samples).toEqual(before);
  expect(samples).toEqual([first, second, third]);
  expect(profile.samples).not.toBe(samples);
  expect(profile.samples).toEqual(samples);
  expect(profile.samples[0]).toBe(first);
  expect(profile.samples[1]).toBe(second);
  expect(profile.samples[2]).toBe(third);
  expect(profile.bottlenecks.map((sample) => sample.label)).toEqual(["first", "second", "third"]);
});
