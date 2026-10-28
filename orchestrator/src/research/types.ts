import type { Prediction } from "../evolution/prediction.js";

export interface ResearchFinding {
  topic: string;
  source: string;
  summary: string;
  suggestedConvention?: string;
  suggestedUpgrade?: string;
  /** 改动建议的可证伪预测；缺省或不合格时为 undefined。 */
  prediction?: Prediction;
}

export interface Researcher {
  research(topic: string): Promise<ResearchFinding[]>;
}
