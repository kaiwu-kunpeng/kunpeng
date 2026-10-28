import { clientSource } from "../helpers/client-source.js";
import { describe, it, expect } from "vitest";

describe("client 路由白名单含 #/skills", () => {
  it("#/skills 与 #/solutions 在同一白名单条件里", () => {
    const src = clientSource();
    const line = src.split("\n").find((l) => l.includes('hash === "#/solutions"'));
    expect(line).toBeTruthy();
    expect(line).toContain('hash === "#/skills"');
  });
});
