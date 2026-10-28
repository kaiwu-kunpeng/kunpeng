// 设计 BRIEF 投资门:结构化 brief + 确定性校验 + 中英双轨渲染。零依赖,纯函数,无 IO。
export type Locale = "zh" | "en" | "both";

export interface DesignBrief {
  projectType: string;     // 项目类型,如「研发指挥仪表盘」
  audience: string;        // 受众
  primaryGoal: string;     // 页面唯一职责
  tone: string;            // 语气/性格(用产品契合句,禁空词)
  mustHave: string[];      // 必备项
  forbidden: string[];     // 禁止动作(如「紫渐变」「brutalism」)
  techStack: string;       // 技术栈
  locale: Locale;          // 中/英/双轨
  successMetric: string;   // 成功指标
  signature?: string;      // 招牌元素(推荐但非必填)
  referenceBrands?: string[]; // 参考品牌(可选)
  referenceUrl?: string;   // 文本参考 URL(可选)
  referenceNotes?: string; // 文本参考说明(可选)
}

// 被禁的空词(语气字段里出现即违规);大小写不敏感;中英都查。
export const BANNED_TONE_WORDS: string[] = [
  "modern", "clean", "sleek", "elegant", "minimal", "beautiful", "intuitive",
  "现代", "简洁", "干净", "优雅", "极简", "美观", "好看",
];

// 必填字段(referenceBrands / signature 不在必填内)。
export const REQUIRED_FIELDS: (keyof DesignBrief)[] = [
  "projectType", "audience", "primaryGoal", "tone", "mustHave", "forbidden", "techStack", "locale", "successMetric",
];

export interface GateResult {
  ok: boolean;
  missing: string[];      // 缺失/为空的必填字段名
  violations: string[];   // 违规说明(如「语气含被禁空词: modern」)
  warnings: string[];     // 非阻断提醒(如「未指定 signature 招牌元素」)
}

function isMissingRequired(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function joinZh(items: string[]): string {
  return items.join("、");
}

function joinEn(items: string[]): string {
  return items.join(", ");
}

// 投资门:必填齐 + 语气无禁词 → ok:true。数组字段空数组算缺失。
export function validateBrief(brief: Partial<DesignBrief>): GateResult {
  const missing = REQUIRED_FIELDS.filter((field) => isMissingRequired(brief[field])).map((field) => String(field));
  const tone = brief.tone?.toLocaleLowerCase() ?? "";
  const violations = BANNED_TONE_WORDS.filter((word) => tone.includes(word.toLocaleLowerCase())).map(
    (word) => `语气含被禁空词: ${word}`,
  );
  const warnings = isMissingRequired(brief.signature) ? ["未指定 signature 招牌元素"] : [];

  return {
    ok: missing.length === 0 && violations.length === 0,
    missing,
    violations,
    warnings,
  };
}

// 渲染中英双轨 BRIEF.md。locale==="both" 时中英字段标签都出;"zh"只中、"en"只英。
export function formatBriefMd(brief: DesignBrief): string {
  const lines = ["# 设计 BRIEF", ""];
  const includeZh = brief.locale === "zh" || brief.locale === "both";
  const includeEn = brief.locale === "en" || brief.locale === "both";

  if (includeZh) {
    lines.push(
      `- 项目类型: ${brief.projectType}`,
      `- 受众: ${brief.audience}`,
      `- 页面唯一职责: ${brief.primaryGoal}`,
      `- 语气/性格: ${brief.tone}`,
      `- 必备项: ${joinZh(brief.mustHave)}`,
      `- 禁止动作: ${joinZh(brief.forbidden)}`,
      `- 技术栈: ${brief.techStack}`,
      `- 语言: ${brief.locale}`,
      `- 成功指标: ${brief.successMetric}`,
    );
    if (brief.signature) {
      lines.push(`- 招牌元素: ${brief.signature}`);
    }
    if (brief.referenceBrands && brief.referenceBrands.length > 0) {
      lines.push(`- 参考品牌: ${joinZh(brief.referenceBrands)}`);
    }
    if (brief.referenceUrl) {
      lines.push(`- 参考链接: ${brief.referenceUrl}`);
    }
    if (brief.referenceNotes) {
      lines.push(`- 参考说明: ${brief.referenceNotes}`);
    }
  }

  if (includeZh && includeEn) {
    lines.push("");
  }

  if (includeEn) {
    lines.push(
      `- Project Type: ${brief.projectType}`,
      `- Audience: ${brief.audience}`,
      `- Primary Goal: ${brief.primaryGoal}`,
      `- Tone: ${brief.tone}`,
      `- Must Have: ${joinEn(brief.mustHave)}`,
      `- Forbidden: ${joinEn(brief.forbidden)}`,
      `- Tech Stack: ${brief.techStack}`,
      `- Locale: ${brief.locale}`,
      `- Success Metric: ${brief.successMetric}`,
    );
    if (brief.signature) {
      lines.push(`- Signature: ${brief.signature}`);
    }
    if (brief.referenceBrands && brief.referenceBrands.length > 0) {
      lines.push(`- Reference Brands: ${joinEn(brief.referenceBrands)}`);
    }
    if (brief.referenceUrl) {
      lines.push(`- Reference URL: ${brief.referenceUrl}`);
    }
    if (brief.referenceNotes) {
      lines.push(`- Reference Notes: ${brief.referenceNotes}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
