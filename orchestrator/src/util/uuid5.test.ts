import { describe, expect, test } from "vitest";

import { SCRAPED_NS, uuidv5 } from "./uuid5.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidv5", () => {
  test("generates a legal deterministic RFC-4122 v5 UUID", () => {
    const first = uuidv5("example", SCRAPED_NS);
    const second = uuidv5("example", SCRAPED_NS);

    expect(first).toMatch(UUID_RE);
    expect(first).toBe(second);
    expect(first.split("-")[2]?.[0]).toBe("5");
    expect(Number.parseInt(first.split("-")[3]?.[0] ?? "0", 16) & 0x8).toBe(0x8);
    expect(uuidv5("different", SCRAPED_NS)).not.toBe(first);
  });

  test("matches the RFC DNS namespace v5 example vector", () => {
    expect(uuidv5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  test("rejects invalid namespace UUIDs", () => {
    expect(() => uuidv5("example", "not-a-uuid")).toThrow(/invalid namespace UUID/);
  });
});
