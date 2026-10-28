/** 从含噪声的文本里提取第一个完整 JSON 对象字符串。 */
export function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("extractFirstJsonObject: 无 JSON 对象");

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error("extractFirstJsonObject: JSON 对象不完整");
}

/** 从含噪声的文本里提取第一个完整 JSON 数组字符串（字符串感知的平衡扫描，忽略串内/对象内的方括号）。 */
export function extractFirstJsonArray(text: string): string {
  const start = text.indexOf("[");
  if (start < 0) throw new Error("extractFirstJsonArray: 无 JSON 数组");

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
    } else if (c === '"') {
      inStr = true;
    } else if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error("extractFirstJsonArray: JSON 数组不完整");
}
