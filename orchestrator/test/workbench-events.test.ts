import { expect, test } from "vitest";
import { renderDriverEvent } from "../src/server/ui/workbench-events.js";

test("stage/token/gate/done 各渲成带固定 class 的 HTML,且转义", () => {
  expect(renderDriverEvent({ type: "stage", stage: "implement" }))
    .toContain('class="kp-ev kp-ev-stage"');
  expect(renderDriverEvent({ type: "stage", stage: "implement" })).toContain("implement");

  const tok = renderDriverEvent({ type: "token", text: "<b>hi</b>" });
  expect(tok).toContain('class="kp-ev-token"');
  expect(tok).toContain("&lt;b&gt;hi&lt;/b&gt;");
  expect(tok).not.toContain("<b>hi</b>");

  const gate = renderDriverEvent({ type: "gate-needed", gateId: "f1", what: "合并?" });
  expect(gate).toContain('data-gate="f1"');
  expect(gate).toContain('data-gate-yes="f1"');
  expect(gate).toContain('data-gate-no="f1"');

  expect(renderDriverEvent({ type: "done", summary: "ok" })).toContain("kp-ev-done");
});
