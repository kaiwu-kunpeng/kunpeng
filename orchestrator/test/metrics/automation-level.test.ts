import { expect, test } from "vitest";
import { classify } from "../../src/metrics/automation-level.js";

test("L3 when human barely intervenes", () => {
  expect(classify({ durationMin: 12, userMsgs: 1, userChars: 120 })).toBe("L3");
  expect(classify({ durationMin: 30, userMsgs: 2, userChars: 400 })).toBe("L3");
});

test("L1 when human intervenes heavily", () => {
  expect(classify({ durationMin: 90, userMsgs: 9, userChars: 300 })).toBe("L1");
  expect(classify({ durationMin: 90, userMsgs: 3, userChars: 2500 })).toBe("L1");
});

test("L2 in between", () => {
  expect(classify({ durationMin: 40, userMsgs: 4, userChars: 800 })).toBe("L2");
});