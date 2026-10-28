import { scanAntiPatterns, type AntiPatternHit } from "./anti-pattern-scan.js";
import { seedFromAdvice, renderMasterMd, type DesignSystem } from "./design-system-store.js";
import { searchDesignKnowledge, type DesignAdvice } from "./knowledge.js";

export interface DesignPipelineResult {
  brief: string;
  advice: DesignAdvice;
  master: DesignSystem;
  masterMd: string;
  css: string;
  antiPatternHits: AntiPatternHit[];
}

export function renderMasterCss(master: DesignSystem): string {
  const lines = [":root{"];
  if (master.palette) {
    lines.push(`  --primary:${master.palette.primary};`);
    lines.push(`  --secondary:${master.palette.secondary};`);
    lines.push(`  --cta:${master.palette.cta};`);
  }
  if (master.fonts) {
    lines.push(`  --font-serif:"${master.fonts.serif}",serif;`);
    lines.push(`  --font-sans:"${master.fonts.sans}",system-ui,sans-serif;`);
  }
  lines.push("}");
  lines.push("a,button{transition:all 220ms ease}");
  lines.push("a:focus-visible,button:focus-visible{outline:2px solid var(--primary,#2563eb);outline-offset:2px}");
  return `${lines.join("\n")}\n`;
}

export function runDesignPipeline(brief: string): DesignPipelineResult {
  const advice = searchDesignKnowledge(brief);
  const master = seedFromAdvice(advice);
  const css = renderMasterCss(master);
  return {
    brief,
    advice,
    master,
    masterMd: renderMasterMd(master),
    css,
    antiPatternHits: scanAntiPatterns({ css }),
  };
}
