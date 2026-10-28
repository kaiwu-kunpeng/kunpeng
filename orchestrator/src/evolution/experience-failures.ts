import type { Artifact } from "../artifacts/types.js";
import type { FailureRecord } from "./failure-digest.js";

export const UNCLASSIFIED_FAILURE = "其它";

const MAX_EVIDENCE_LENGTH = 240;

const SIGNATURES: Array<{ category: string; patterns: RegExp[] }> = [
  {
    category: "审计/验收缺失",
    patterns: [
      /验收测试审计/,
      /审计未通过/,
      /未给出验收/,
      /验收命令/,
      /验收验证/,
      /弱测试/,
      /仅存在性/,
      /acceptance/i,
    ],
  },
  { category: "类型/tsc", patterns: [/类型/, /\btsc\b/i, /\bTS\d{4}\b/] },
  { category: "范围越界", patterns: [/范围越界/, /越界/, /\bscope\b/i, /forbid/i] },
  { category: "测试缺失", patterns: [/测试缺失/, /缺测/, /未测试/, /no tests?/i, /missing tests?/i] },
  { category: "构建失败", patterns: [/构建失败/, /build failed/i, /npm run build/i] },
  { category: "合并冲突", patterns: [/合并冲突/, /merge conflict/i, /冲突标记/, /<{7,}|={7,}|>{7,}/] },
  { category: "ESM/导入", patterns: [/\bESM\b/i, /导入/, /import .*\.js/i, /ERR_MODULE_NOT_FOUND/] },
];

function textFrom(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncateEvidence(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= MAX_EVIDENCE_LENGTH ? normalized : `${normalized.slice(0, MAX_EVIDENCE_LENGTH - 1)}…`;
}

export function classifyFailureMode(text: string): string {
  for (const signature of SIGNATURES) {
    if (signature.patterns.some((pattern) => pattern.test(text))) return signature.category;
  }
  return UNCLASSIFIED_FAILURE;
}

export function experiencesToFailureRecords(experiences: Artifact[]): FailureRecord[] {
  return experiences.map((experience) => {
    const sourceFlow = textFrom(experience.meta.sourceFlow) || experience.id;
    const outcome = textFrom(experience.meta.outcome);
    const evidence = [
      textFrom(experience.meta.reason),
      textFrom(experience.meta.evidence),
      experience.body,
    ].filter((part) => part.trim().length > 0).join("\n");

    return {
      category: classifyFailureMode(evidence),
      outcome,
      context: truncateEvidence(`sourceFlow=${sourceFlow}\n${evidence}`),
    };
  });
}

export function researchableFailureRecords(experiences: Artifact[]): FailureRecord[] {
  return experiencesToFailureRecords(experiences).filter((record) => record.category !== UNCLASSIFIED_FAILURE);
}
