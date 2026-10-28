import { searchDesignKnowledge } from "./knowledge.js";
import { getAnchor } from "./design-anchors.js";

const STYLE_TO_ANCHOR: Record<string, string> = {
  minimal: "Swiss",
  glassmorphism: "Aurora",
  bento: "Swiss",
  neumorphism: "Organic",
  brutalism: "Brutalist",
  claymorphism: "Organic",
  editorial: "Lo-Fi",
  "soft-ui": "Organic",
  corporate: "Industrial",
  flat: "Swiss",
};

export interface DesignSuggestion {
  seedHex?: string;
  anchor?: string;
  styleName?: string;
}

export function suggestDesign(query: string): DesignSuggestion {
  const result = searchDesignKnowledge(query);
  const seedHex = result.palettes[0]?.primary;
  const style = result.styles[0];
  const mappedAnchor = style ? STYLE_TO_ANCHOR[style.id] : undefined;
  const anchor = mappedAnchor && getAnchor(mappedAnchor) ? mappedAnchor : undefined;

  return {
    seedHex,
    anchor,
    styleName: style?.name,
  };
}
