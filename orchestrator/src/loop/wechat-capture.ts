import { recipeRegistry, type LoopRecipe } from "./recipe.js";
import { runWechatCaptureWave } from "./recipes/wechat-capture/runwave.js";

const wechatCaptureRecipe: LoopRecipe = {
  id: "wechat-capture",
  acceptsSkills: false,
  defaultEvidenceKind: "crawl",
  listLevers(def) {
    return def.levers;
  },
  defaultLeverLevel: () => "L0",
  async readMetric(def) {
    return def.metric.current;
  },
  runWave: runWechatCaptureWave,
};

recipeRegistry[wechatCaptureRecipe.id] = wechatCaptureRecipe;
