import type { PlanModel, PlanPhase, PlanFlow } from "./types.js";
import { extractAcceptance } from "./acceptance.js";

interface Heading { level: number; text: string; line: number; }

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9一-龥]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "flow";
}

function mkFlow(phaseTitle: string, phaseIdx: number, flowIdx: number, title: string, requirement: string): PlanFlow {
  // 显式验收（```accept / 验收:）在分解时即采信（spec §2 tier-1，最可靠）；无则留空待 CLI 翻译。
  const acceptanceCmd = extractAcceptance(requirement) ?? undefined;
  return { id: `${slug(phaseTitle)}-${phaseIdx}-${flowIdx}`, title, requirement, acceptanceCmd };
}

/** checklist 项各一条 flow；无 checklist → 整块一条 flow。 */
function flowsFromBlock(block: string, phaseTitle: string, phaseIdx: number): PlanFlow[] {
  const lines = block.split("\n");
  const items: { text: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^- \[[ xX]\]\s+/.test(lines[i])) items.push({ text: lines[i].replace(/^- \[[ xX]\]\s+/, "").trim(), line: i });
  }
  if (items.length) {
    return items.map((it, idx) => {
      const iEnd = idx + 1 < items.length ? items[idx + 1].line : lines.length;
      const reqText = lines.slice(it.line, iEnd).join("\n").trim();
      return mkFlow(phaseTitle, phaseIdx, idx, it.text, reqText);
    });
  }
  const body = block.trim();
  return [mkFlow(phaseTitle, phaseIdx, 0, phaseTitle, body || phaseTitle)];
}

/** 确定性自适应分解：最浅标题层=阶段，深一层标题/checklist=flow，否则整段一流。 */
export function parseMethodPlan(markdown: string): PlanModel {
  const lines = markdown.split("\n");
  const headings: Heading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (m) headings.push({ level: m[1].length, text: m[2], line: i });
  }
  if (headings.length === 0) {
    return { phases: [{ title: "default", flows: flowsFromBlock(markdown, "default", 0) }] };
  }
  // 阶段层选取：单个 H1 视为文档标题（不当阶段），阶段从最浅的 H2+ 取；
  // 但若有 ≥2 个 H1，则 H1 本身就是并列的顶层阶段。
  const h1count = headings.filter((h) => h.level === 1).length;
  let lphase: number;
  if (h1count >= 2) {
    lphase = 1;
  } else {
    const deep = headings.filter((h) => h.level >= 2);
    lphase = deep.length ? Math.min(...deep.map((h) => h.level)) : 1;
  }
  const phaseHeads = headings.filter((h) => h.level === lphase);
  const phases: PlanPhase[] = [];
  for (let p = 0; p < phaseHeads.length; p++) {
    const start = phaseHeads[p].line;
    const end = p + 1 < phaseHeads.length ? phaseHeads[p + 1].line : lines.length;
    const title = phaseHeads[p].text;
    const subs = headings.filter((h) => h.level === lphase + 1 && h.line > start && h.line < end);
    let flows: PlanFlow[];
    if (subs.length) {
      flows = subs.map((s, idx) => {
        const sEnd = idx + 1 < subs.length ? subs[idx + 1].line : end;
        const reqText = lines.slice(s.line, sEnd).join("\n").trim();
        return mkFlow(title, p, idx, s.text, reqText);
      });
    } else {
      flows = flowsFromBlock(lines.slice(start + 1, end).join("\n"), title, p);
    }
    phases.push({ title, flows });
  }
  return { phases };
}
