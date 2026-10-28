import { expect, test } from "vitest";
import { parseAuditFindings, severityScore } from "../src/evolution/security-audit.js";

const AUDIT = JSON.stringify({
  vulnerabilities: {
    lodash: { name: "lodash", severity: "critical", via: ["CVE-2021-x"] },
    minimist: { name: "minimist", severity: "moderate", via: [] },
  },
});

test("severityScore 严格单调：critical>high>moderate>low>unknown", () => {
  expect(severityScore("critical")).toBeGreaterThan(severityScore("high"));
  expect(severityScore("high")).toBeGreaterThan(severityScore("moderate"));
  expect(severityScore("moderate")).toBeGreaterThan(severityScore("low"));
  expect(severityScore("low")).toBeGreaterThan(severityScore("whatever-unknown"));
});

test("parseAuditFindings 每漏洞→security 通道 finding，按 severity 评分，sources 含 npm-audit:包名", () => {
  const out = parseAuditFindings(AUDIT);
  expect(out.length).toBe(2);
  expect(out.every((f) => f.channel === "security")).toBe(true);
  expect(out.every((f) => f.evidenceState === "untested")).toBe(true);
  const lodash = out.find((f) => f.title.includes("lodash"))!;
  const minimist = out.find((f) => f.title.includes("minimist"))!;
  expect(lodash.score).toBeGreaterThan(minimist.score);
  expect(lodash.score).toBe(100);
  expect(lodash.sources).toContain("npm-audit:lodash");
});

test("空/无漏洞/坏JSON/缺字段 都安全返回 []或容错，绝不抛错", () => {
  expect(parseAuditFindings(JSON.stringify({ vulnerabilities: {} }))).toEqual([]);
  expect(parseAuditFindings("not json at all")).toEqual([]);
  expect(parseAuditFindings("")).toEqual([]);
  expect(parseAuditFindings(JSON.stringify({}))).toEqual([]);
});

test("畸形条目(缺 severity)容错为 unknown 评分，不抛错不丢整体", () => {
  const out = parseAuditFindings(JSON.stringify({ vulnerabilities: { foo: { name: "foo" } } }));
  expect(out.length).toBe(1);
  expect(out[0].channel).toBe("security");
  expect(out[0].score).toBe(severityScore("unknown"));
});