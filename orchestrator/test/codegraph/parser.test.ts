import { expect, test } from "vitest";
import { parseSource } from "../../src/codegraph/parser.js";

const src = `
export function login() { validate(); hashPassword(); }
function validate() { return true; }
function hashPassword() { return "x"; }
export class UserService {}
`;

test("extracts declaration nodes (functions + class)", () => {
  const { nodes } = parseSource("user.ts", src);
  const names = nodes.map((n) => n.name).sort();
  expect(names).toContain("login");
  expect(names).toContain("validate");
  expect(names).toContain("UserService");
  expect(nodes.find((n) => n.name === "UserService")?.kind).toBe("class");
  expect(nodes.find((n) => n.name === "login")?.kind).toBe("function");
});

test("extracts call edges between declarations in the same source", () => {
  const { nodes, edges } = parseSource("user.ts", src);
  const id = (name: string) => nodes.find((n) => n.name === name)!.id;
  const hasEdge = (from: string, to: string) =>
    edges.some((e) => e.kind === "calls" && e.from === id(from) && e.to === id(to));
  expect(hasEdge("login", "validate")).toBe(true);
  expect(hasEdge("login", "hashPassword")).toBe(true);
});

test("node line numbers are 1-based", () => {
  const { nodes } = parseSource("user.ts", src);
  expect(nodes.find((n) => n.name === "login")?.line).toBe(2);
});