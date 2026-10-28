import { describe, expect, test, vi } from "vitest";
import { promote } from "../../src/knowledge/promote.js";
import type { Capture } from "../../src/knowledge/capture-store.js";

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "cap-1",
    source: "text",
    kind: "note",
    raw: "raw material",
    tags: [],
    createdAt: 100,
    promoted: true,
    ...overrides,
  };
}

describe("promote", () => {
  test("returns promoted capture without enrichment when enrich is omitted", async () => {
    const item = capture();
    const promoteCapture = vi.fn(async () => item);

    const result = await promote("cap-1", { promoteCapture });

    expect(result).toEqual({ capture: item });
    expect(result?.capture.promoted).toBe(true);
    expect(promoteCapture).toHaveBeenCalledWith("cap-1");
    expect(result).not.toHaveProperty("enriched");
  });

  test("returns enrichment from injected enrich using capture raw", async () => {
    const item = capture({ raw: "待富集原料" });
    const promoteCapture = vi.fn(async () => item);
    const enrich = vi.fn(async () => ({ summary: "富", tags: ["a"] }));

    const result = await promote("cap-1", { promoteCapture, enrich });

    expect(result).toEqual({ capture: item, enriched: { summary: "富", tags: ["a"] } });
    expect(result?.enriched?.summary).toBe("富");
    expect(enrich).toHaveBeenCalledWith(item.raw);
  });

  test("returns null for missing capture and does not enrich", async () => {
    const promoteCapture = vi.fn(async () => null);
    const enrich = vi.fn(async () => ({ summary: "富", tags: ["a"] }));

    await expect(promote("missing", { promoteCapture, enrich })).resolves.toBeNull();
    expect(enrich).not.toHaveBeenCalled();
  });
});
