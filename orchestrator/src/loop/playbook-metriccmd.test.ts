import { describe, it, expect } from "vitest";
import { parsePlaybook } from "./playbook.js";

describe("playbook frontmatter metricCmd", () => {
  it("解析出 metricCmd", () => {
    const md = ["---", "id: demo", "metricCmd: ls content-drafts | wc -l", "---", "# body"].join("\n");
    const def = parsePlaybook(md, "demo");
    expect(def).not.toBeNull();
    expect(def!.metricCmd).toBe("ls content-drafts | wc -l");
  });
  it("未声明时为 undefined", () => {
    const md = ["---", "id: demo", "---", "# body"].join("\n");
    const def = parsePlaybook(md, "demo");
    expect(def).not.toBeNull();
    expect(def!.metricCmd).toBeUndefined();
  });
});