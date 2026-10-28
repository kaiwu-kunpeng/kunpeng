import { defaultLeverLevelByName, recipeRegistry, type LoopRecipe } from "./recipe.js";
import { runAgentPlaybookWave } from "./recipes/agent-playbook/runwave.js";

const agentPlaybookRecipe: LoopRecipe = {
  id: "agent-playbook",
  acceptsSkills: true,
  defaultEvidenceKind: "repo-count",
  listLevers(def) {
    return def.levers;
  },
  defaultLeverLevel: defaultLeverLevelByName,
  async readMetric(def) {
    return def.metric.current;
  },
  runWave: runAgentPlaybookWave,
};

recipeRegistry[agentPlaybookRecipe.id] = agentPlaybookRecipe;
