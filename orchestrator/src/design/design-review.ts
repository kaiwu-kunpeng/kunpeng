export interface CritiqueOpts {
  briefMd?: string;
  anchor?: string;
}

export function buildCritiquePrompt(opts: CritiqueOpts): string {
  const sections = [
    "你是视觉复评者 / visual reviewer。你正在查看一张设计稿截图, 请只基于截图本身做裁决。",
    "逐项检查:",
    "- 是否存在溢出/裁切, 内容是否被 viewport、容器或按钮边界截断。",
    "- 是否存在对比度不足, 文本、图标、边框和状态色是否清晰可读。",
    "- 是否存在触控目标 <44px, 主要按钮、图标按钮和可点击区域是否过小。",
    "- 是否命中三大 AI 默认审美: #F4F1EA 奶油+衬线, acid-green 近黑+荧光, broadsheet 报纸密栏。",
    "- 整体是否显得通用、模板化、generic, 缺少具体产品/场景信号。",
  ];

  if (opts.anchor) {
    sections.push(`风格锚 / style anchor: ${opts.anchor}`);
    sections.push("判断截图是否贴合该风格锚, 不贴合时把差距写入 issues。");
  }

  if (opts.briefMd) {
    sections.push(`BRIEF:\n${opts.briefMd}`);
    sections.push("判断截图是否贴合 BRIEF 的目标、受众、内容重点和约束, 不贴合时写入 issues。");
  }

  sections.push('只输出 JSON: {"pass":bool,"issues":["..."]}');

  return sections.join("\n");
}

export interface Critique {
  pass: boolean;
  issues: string[];
}

export function parseCritique(text: string): Critique {
  const jsonText = extractFirstJsonObject(text);
  if (!jsonText) {
    return parseFailure();
  }

  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (!isObject(parsed)) {
      return parseFailure();
    }

    return {
      pass: typeof parsed.pass === "boolean" ? parsed.pass : false,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.filter((issue): issue is string => typeof issue === "string")
        : [],
    };
  } catch {
    return parseFailure();
  }
}

export interface Verdict {
  pass: boolean;
  mustFix: string[];
}

export function combineVerdict(lintP0: number, critique: Critique): Verdict {
  const lintIssues = lintP0 > 0 ? ["三大默认审美命中"] : [];

  return {
    pass: lintP0 === 0 && critique.pass,
    mustFix: [...critique.issues, ...lintIssues].filter((issue) => issue.length > 0),
  };
}

export function buildFixPrompt(systemPrompt: string, mustFix: string[]): string {
  return `${systemPrompt}\n\n# 上一版严重不合格 —— 本轮硬性要求\n下列每条都是必须彻底消除的缺陷(不是缓解):优先删除冗余,绝不新增重复结构。逐条修复:\n${mustFix
    .map((issue) => `- ${issue}`)
    .join("\n")}`;
}

function parseFailure(): Critique {
  return { pass: false, issues: ["复评结果解析失败"] };
}

function isObject(value: unknown): value is { pass?: unknown; issues?: unknown } {
  return typeof value === "object" && value !== null;
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
      if (depth < 0) {
        return undefined;
      }
    }
  }

  return undefined;
}
