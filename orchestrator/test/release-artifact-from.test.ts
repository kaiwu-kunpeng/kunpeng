import { describe, expect, test } from "vitest";
import { releaseArtifactFrom } from "../src/loop/build-release.js";

describe("releaseArtifactFrom", () => {
  test("maps successful builds to draft release artifacts", () => {
    const artifact = releaseArtifactFrom({ released: true, output: "ok" }, "vx", "npm run build");

    expect(artifact.kind).toBe("release");
    expect(artifact.id).toBe("release-vx");
    expect(artifact.status).toBe("draft");
    expect(artifact.body).toContain("released: true");
    expect(artifact.meta).toMatchObject({ released: true });
  });

  test("maps failed builds to rolled-back release artifacts", () => {
    const artifact = releaseArtifactFrom({ released: false, output: "boom" }, "vy", "make");

    expect(artifact.status).toBe("rolled-back");
    expect(artifact.body).toContain("released: false");
  });

  test("is deterministic for the same inputs", () => {
    const input = { released: true, output: "ok", exitCode: 0 };

    expect(releaseArtifactFrom(input, "vz", "pnpm build")).toEqual(
      releaseArtifactFrom(input, "vz", "pnpm build"),
    );
  });
});
