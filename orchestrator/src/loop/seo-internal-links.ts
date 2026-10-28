import { defaultLeverLevelByName, recipeRegistry, type LoopRecipe } from "./recipe.js";
import { DEFAULT_LEVERS, SEO_INTERNAL_LINKS_RECIPE_ID } from "./recipes/seo-internal-links/core.js";
import { runSeoInternalLinksWave } from "./recipes/seo-internal-links/runwave.js";

const seoInternalLinksRecipe: LoopRecipe = {
  id: SEO_INTERNAL_LINKS_RECIPE_ID,
  acceptsSkills: false,
  defaultEvidenceKind: "crawl",
  listLevers: (def) => def.levers.length ? def.levers : DEFAULT_LEVERS,
  defaultLeverLevel: defaultLeverLevelByName,
  readMetric: async (def) => def.metric.current,
  runWave: runSeoInternalLinksWave,
};

recipeRegistry[seoInternalLinksRecipe.id] = seoInternalLinksRecipe;
