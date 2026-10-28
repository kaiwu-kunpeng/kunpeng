import { expect, test } from "vitest";
import {
  detectScopeDrift,
  parseScopeDeclaration,
  type ScopeDecl,
} from "../src/verify/scope-gate.js";

test("parses allow and forbid declarations from a scope fence", () => {
  const specText = [
    "# Spec",
    "",
    "```scope",
    "allow: src/a/**",
    "forbid: src/b/**",
    "```",
  ].join("\n");

  expect(parseScopeDeclaration(specText)).toEqual({
    allow: ["src/a/**"],
    forbid: ["src/b/**"],
  });
});

test("returns undefined when no scope fence exists", () => {
  expect(parseScopeDeclaration("# Spec\n\nNo scope here.")).toBeUndefined();
});

test("allows changed files inside a non-empty allow list", () => {
  const result = detectScopeDrift(["src/a/x.ts"], { allow: ["src/a/**"], forbid: [] });

  expect(result).toEqual({ ok: true, violations: [] });
});

test("reports files outside a non-empty allow list", () => {
  const result = detectScopeDrift(["src/a/x.ts", "src/c/y.ts"], {
    allow: ["src/a/**"],
    forbid: [],
  });

  expect(result).toEqual({
    ok: false,
    violations: [{ file: "src/c/y.ts", rule: "outside-allow" }],
  });
});

test("reports forbidden files before allow-list checks", () => {
  const result = detectScopeDrift(["src/core/k.ts"], {
    allow: ["src/feature/**"],
    forbid: ["**/*.lock", "src/core/**"],
  });

  expect(result).toEqual({
    ok: false,
    violations: [{ file: "src/core/k.ts", rule: "forbidden" }],
  });
});

test("does not restrict files by allow list when allow is empty", () => {
  const result = detectScopeDrift(["src/y/z.ts"], {
    allow: [],
    forbid: ["src/x/**"],
  });

  expect(result).toEqual({ ok: true, violations: [] });
});

test("glob double-star crosses directories and single-star does not", () => {
  const scope: ScopeDecl = {
    allow: ["src/*.ts", "src/**"],
    forbid: ["src/*.lock"],
  };

  expect(detectScopeDrift(["src/a.ts"], { allow: ["src/*.ts"], forbid: [] }).ok).toBe(true);
  expect(detectScopeDrift(["src/sub/a.ts"], { allow: ["src/*.ts"], forbid: [] })).toEqual({
    ok: false,
    violations: [{ file: "src/sub/a.ts", rule: "outside-allow" }],
  });
  expect(detectScopeDrift(["src/sub/a.ts"], { allow: ["src/**"], forbid: [] }).ok).toBe(true);
  expect(detectScopeDrift(["src/a.lock"], scope)).toEqual({
    ok: false,
    violations: [{ file: "src/a.lock", rule: "forbidden" }],
  });
});

test("does not mutate inputs", () => {
  const changedFiles = ["src/a/x.ts", "src/c/y.ts"];
  const scope: ScopeDecl = { allow: ["src/a/**"], forbid: ["src/b/**"] };

  detectScopeDrift(changedFiles, scope);

  expect(changedFiles).toEqual(["src/a/x.ts", "src/c/y.ts"]);
  expect(scope).toEqual({ allow: ["src/a/**"], forbid: ["src/b/**"] });
});
