import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

type Pkg = { overrides: Record<string, string> };
type Lock = { packages: Record<string, { version: string }> };

const read = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) as T;

describe("js-yaml 漏洞修补 GHSA-2883-xcg3-v3hh(作者锁定)", () => {
  it("package.json override 钉到 ^3.15.2", () => {
    expect(read<Pkg>("package.json").overrides["js-yaml"]).toBe("^3.15.2");
  });

  it("lockfile 解析到 3.15.2", () => {
    expect(read<Lock>("package-lock.json").packages["node_modules/js-yaml"].version).toBe("3.15.2");
  });

  it("其它 override 原样保留", () => {
    const o = read<Pkg>("package.json").overrides;
    expect(o.postcss).toBe("^8.5.26");
    expect(o.nanoid).toBe("^3.3.18");
    expect(o["brace-expansion"]).toBe("^5.0.9");
  });
});
