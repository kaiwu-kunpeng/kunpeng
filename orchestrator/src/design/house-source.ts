// House 默认设计来源 —— 三级回退中的兜底层：shadcn/ui + Geist。
// 「无方案设计」时以三套 shadcn 基色预设 neutral / slate / stone 作为候选，
// 供后续选择门展示。纯确定性、无 IO、无 LLM（C8）。
// 跨模块仅做类型导入 contract（C1：contract.ts 由阶段一独占，不得重建）。
import type {
  DesignSource,
  DesignSourceInput,
  DesignContract,
  DesignCandidate,
} from "./contract.js";

/** 三套 shadcn 基色预设，作「无方案设计」时的兜底候选。长度恒为 3。 */
export const HOUSE_PRESETS = ["neutral", "slate", "stone"] as const;

/** 预设名联合类型。 */
export type HousePreset = (typeof HOUSE_PRESETS)[number];

/**
 * 每个预设的差异化调色板。三套背景色各不相同（neutral 纯白 / slate 偏冷 /
 * stone 偏暖），对应 Tailwind 的 *-50 / *-100 灰阶，保证候选之间确有差异。
 */
const PALETTE: Record<
  string,
  { background: string; foreground: string; muted: string; accent: string }
> = {
  neutral: { background: "#ffffff", foreground: "#0a0a0a", muted: "#f5f5f5", accent: "#171717" },
  slate: { background: "#f8fafc", foreground: "#020817", muted: "#f1f5f9", accent: "#0f172a" },
  stone: { background: "#fafaf9", foreground: "#0c0a09", muted: "#f5f5f4", accent: "#1c1917" },
};

/** 未知预设回退到 neutral 调色板（构造器允许任意字符串）。 */
const FALLBACK = PALETTE.neutral;

/**
 * House 默认来源：把一套 shadcn 基色预设解析为确定性设计契约。
 *
 * 满足 contract 中的 `DesignSource` 接口（`name` + 异步 `resolve`）。额外暴露
 * `id`（= `house:<preset>`），契约 `source` 与之一致。
 */
export class HouseDefaultSource implements DesignSource {
  /** 来源标识，如 `house:neutral`。 */
  readonly id: string;
  /** DesignSource.name —— 与 id 一致，供选择门显示。 */
  readonly name: string;
  /** 本来源绑定的 shadcn 基色预设。 */
  readonly preset: string;

  constructor(preset = "neutral") {
    this.preset = preset;
    this.id = `house:${preset}`;
    this.name = this.id;
  }

  /**
   * 解析为候选契约。确定性：输出只由构造时的预设决定，与 input 无关。
   */
  async resolve(_input: DesignSourceInput): Promise<DesignCandidate> {
    return { source: this.id, contract: this.buildContract() };
  }

  /** 构造本预设的设计契约（纯函数，无副作用）。 */
  private buildContract(): DesignContract {
    const p = PALETTE[this.preset] ?? FALLBACK;
    return {
      source: this.id,
      anchor: `shadcn/ui + Geist (${this.preset})`,
      tokens: {
        colors: {
          background: p.background,
          foreground: p.foreground,
          primary: p.accent,
          "primary-foreground": p.background,
          muted: p.muted,
          border: p.muted,
        },
        spacing: {
          xs: "4px",
          sm: "8px",
          md: "16px",
          lg: "24px",
          xl: "32px",
        },
        typography: {
          sans: "Geist, ui-sans-serif, system-ui, sans-serif",
          mono: "Geist Mono, ui-monospace, monospace",
          body: "Geist 16/24",
        },
      },
      components: ["Button", "Card", "Input", "Dialog", "Tabs"],
    };
  }
}

/**
 * 三套 house 兜底候选来源（neutral / slate / stone），供选择门展示为
 * 「无方案设计」时的 3 套候选。
 */
export function housePresetSources(): DesignSource[] {
  return HOUSE_PRESETS.map((p) => new HouseDefaultSource(p));
}
