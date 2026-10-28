import { escHtml } from "../../../util/esc-html.js";

export { escHtml };

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
