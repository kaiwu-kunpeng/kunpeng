import { recipeRegistry, type LoopRecipe } from "./recipe.js";
import { runSiteCaptureWave } from "./recipes/site-capture/runwave.js";

const siteCaptureRecipe: LoopRecipe = {
  id: "site-capture",
  acceptsSkills: false,
  defaultEvidenceKind: "crawl",
  listLevers(def) {
    return def.levers;
  },
  defaultLeverLevel: () => "L0",
  async readMetric(def) {
    return def.metric.current;
  },
  runWave: runSiteCaptureWave,
};

recipeRegistry[siteCaptureRecipe.id] = siteCaptureRecipe;
