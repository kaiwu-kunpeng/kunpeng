import { recipeRegistry, type LoopRecipe } from "./recipe.js";
import { runGeoMonitorWave } from "./recipes/geo-monitor/runwave.js";

const geoMonitorRecipe: LoopRecipe = {
  id: "geo-monitor",
  acceptsSkills: false,
  defaultEvidenceKind: "llm-self-report",
  listLevers(def) {
    return def.levers;
  },
  defaultLeverLevel: () => "L0",
  async readMetric(def) {
    return def.metric.current;
  },
  runWave: runGeoMonitorWave,
};

recipeRegistry[geoMonitorRecipe.id] = geoMonitorRecipe;
