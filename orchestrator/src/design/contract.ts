// 设计契约 contract —— 设计来源 (design source) 的单一类型契约 + 纯函数摘要。
// 本文件无副作用：不读 IO、不调 LLM、无顶层执行逻辑（C8 确定性优先）。

/** 三类设计 token：颜色 / 间距 / 字体。键为 token 名，值为 token 值。 */
export interface DesignTokens {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  typography: Record<string, string>;
}

/** 一份解析完成的设计契约（design source 真相源）。 */
export interface DesignContract {
  /** 来源标识，如 `house:neutral` / `figma:<fileKey>`。 */
  source: string;
  /** 设计锚点（参考体系），如 `shadcn/ui + Geist`。 */
  anchor: string;
  /** 设计 token 三组。 */
  tokens: DesignTokens;
  /** 覆盖到的组件名列表，如 `["Button", "Card"]`。 */
  components: string[];
}

/** 项目落库的设计配置（选择门确定来源后写入 projectConfig）。 */
export interface ProjectDesignConfig {
  /** 选定的来源标识。 */
  source: string;
  /** 选定的设计锚点。 */
  anchor: string;
  /** 已解析的契约（可选：尚未解析时为空）。 */
  contract?: DesignContract;
}

/** 解析某个来源所需的输入。字段皆可选——不同来源/调用点取所需。 */
export interface DesignSourceInput {
  /** 来源类型，如 `house` / `figma`。 */
  kind?: string;
  /** 来源引用（如 figma fileKey / house 预设名）。 */
  ref?: string;
  /** 进来的方案 Markdown（判定方案是否自带设计 / 抽取设计意图）。 */
  planMd?: string;
  /** 项目已保存的设计配置（决定 single 模式走哪个来源）。 */
  projectConfig?: ProjectDesignConfig;
}

/** 候选来源：解析出的契约 + 其来源标识，供选择门挑选。 */
export interface DesignCandidate {
  /** 候选来源标识。 */
  source: string;
  /** 该候选解析出的契约。 */
  contract: DesignContract;
}

/** 设计来源接口：把输入解析为候选契约（本阶段仅契约，不实现）。 */
export interface DesignSource {
  /** 来源名称。 */
  name: string;
  /** 解析来源，产出候选契约。 */
  resolve(input: DesignSourceInput): Promise<DesignCandidate>;
}

/**
 * 纯函数：把契约摘要为一行人读文本。
 *
 * 格式：`${source} · ${anchor} · ${N} tokens · ${M} 组件`
 *  - N = colors + spacing + typography 三类 token 键数之和
 *  - M = components 数组长度
 */
export function summarizeContract(c: DesignContract): string {
  const n =
    Object.keys(c.tokens.colors).length +
    Object.keys(c.tokens.spacing).length +
    Object.keys(c.tokens.typography).length;
  const m = c.components.length;
  return `${c.source} · ${c.anchor} · ${n} tokens · ${m} 组件`;
}
