import { expect, test } from "vitest";
import { parseEars, isTestable } from "../../src/spec/ears.js";

test("parses event-driven and ubiquitous EARS lines", () => {
  const text = [
    "WHEN a user submits the form THE SYSTEM SHALL validate inputs",
    "THE SYSTEM SHALL log every request",
    "this is just prose, ignore it",
  ].join("\n");
  const rs = parseEars(text);
  expect(rs.length).toBe(2);
  expect(rs[0].trigger).toBe("a user submits the form");
  expect(rs[0].response).toBe("validate inputs");
  expect(rs[1].trigger).toBeNull();
  expect(rs[1].response).toBe("log every request");
  expect(rs.every(isTestable)).toBe(true);
});