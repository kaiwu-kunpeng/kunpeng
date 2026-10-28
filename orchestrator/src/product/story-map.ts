import type { ProductDefinition, ProjectRisk, StoryMap, StoryMapTask } from "./contract.js";
import { liftAcceptance } from "./gherkin.js";

function buildTasks(acceptance: string[]): StoryMapTask[] {
  return liftAcceptance(acceptance).map((scenario) => ({
    title: scenario.title,
    scenarios: [...scenario.given, ...scenario.when, ...scenario.then],
  }));
}

function buildMilestones(def: ProductDefinition): string[] {
  return [
    `M1：走骨架端到端可用（覆盖 ${def.acceptance.length} 条验收）`,
    ...def.stories.map((story, index) => `M${index + 2}：${story}`),
  ];
}

function buildRisks(def: ProductDefinition): ProjectRisk[] {
  const risks: ProjectRisk[] = [];

  if (def.acceptance.length === 0) {
    risks.push({
      risk: "无验收标准，交付质量不可验证",
      severity: "high",
      mitigation: "补 Gherkin 验收（每条=1任务=1测试）",
    });
  }

  if (def.nonGoals === undefined || def.nonGoals.length === 0) {
    risks.push({
      risk: "未声明 Non-Goals，范围易蔓延/镀金",
      severity: "medium",
      mitigation: "明确列出本期不做项",
    });
  }

  if (def.stories.length > 5) {
    risks.push({
      risk: "故事过多(>5)，难在一个 appetite 内完成",
      severity: "medium",
      mitigation: "切 Walking Skeleton，砍到最薄 MVP",
    });
  }

  if (def.users.length > 3) {
    risks.push({
      risk: "目标用户过宽(>3)，MVP 定位分散",
      severity: "low",
      mitigation: "先服务单一核心用户画像",
    });
  }

  return risks;
}

export function buildStoryMap(def: ProductDefinition): StoryMap {
  const tasks = buildTasks(def.acceptance);

  return {
    backbone: [...def.stories],
    slices: [
      {
        name: "走骨架 (MVP)",
        goal: "最薄端到端可用路径——交付全部验收契约",
        tasks,
        isWalkingSkeleton: true,
      },
    ],
    milestones: buildMilestones(def),
    risks: buildRisks(def),
  };
}
