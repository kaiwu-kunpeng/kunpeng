import { expect, test } from "vitest";
import { htmlToText } from "../../src/knowledge/html-to-text.js";

test("htmlToText strips scripts, styles, tags, and decodes common entities", () => {
  const text = htmlToText("<style>x{}</style><p>你好 &amp; 世界</p><script>bad()</script>");

  expect(text).toContain("你好 & 世界");
  expect(text).not.toContain("bad()");
  expect(text).not.toContain("x{}");
  expect(text).not.toContain("<");
});

test("htmlToText truncates output to maxLen", () => {
  expect(htmlToText(`<p>${"长".repeat(20)}</p>`, 5)).toBe("长".repeat(5));
});
