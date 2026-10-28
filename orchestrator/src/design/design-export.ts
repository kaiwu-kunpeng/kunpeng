import { escHtml as escapeHtml } from "../util/esc-html.js";
export interface DtcgTokens {
  light?: Record<string, { $value: string }>;
  dark?: Record<string, { $value: string }>;
}

export interface FigmaVariablePluginPackage {
  manifest: {
    name: string;
    api: "1.0.0";
    main: "code.js";
    ui: "ui.html";
    editorType: ["figma"];
  };
  code: string;
  uiHtml: string;
}

function flattenDtcgTokens(tokens?: Record<string, { $value: string }>): Record<string, string> {
  return Object.fromEntries(Object.entries(tokens ?? {}).map(([key, token]) => [key, token.$value]));
}

function toTokensStudioSet(
  tokens?: Record<string, { $value: string }>,
): Record<string, { value: string; type: "color" }> {
  return Object.fromEntries(
    Object.entries(tokens ?? {}).map(([key, token]) => [key, { value: token.$value, type: "color" }]),
  );
}

export function toShadcnRegistryItem(name: string, tokens: DtcgTokens): {
  name: string;
  type: "registry:theme";
  cssVars: { light: Record<string, string>; dark: Record<string, string> };
} {
  return {
    name: name === "" ? "design" : name,
    type: "registry:theme",
    cssVars: {
      light: flattenDtcgTokens(tokens.light),
      dark: flattenDtcgTokens(tokens.dark),
    },
  };
}

export function toTokensStudio(
  tokens: DtcgTokens,
): Record<"light" | "dark", Record<string, { value: string; type: "color" }>> {
  return {
    light: toTokensStudioSet(tokens.light),
    dark: toTokensStudioSet(tokens.dark),
  };
}

function pluginName(name: string): string {
  return name.trim() === "" ? "Design Tokens" : `${name.trim()} Design Tokens`;
}

export function toFigmaVariablePlugin(name: string, tokens: DtcgTokens): FigmaVariablePluginPackage {
  const title = pluginName(name);
  const payload = {
    collectionName: title,
    light: flattenDtcgTokens(tokens.light),
    dark: flattenDtcgTokens(tokens.dark),
  };

  return {
    manifest: {
      name: title,
      api: "1.0.0",
      main: "code.js",
      ui: "ui.html",
      editorType: ["figma"],
    },
    code: `const TOKENS = ${JSON.stringify(payload, null, 2)};

function hexToRgb(hex) {
  const raw = hex.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

function createColorVariable(collection, modeId, name, value) {
  const variable = figma.variables.createVariable(name, collection, "COLOR");
  variable.setValueForMode(modeId, hexToRgb(value));
  return variable;
}

const collection = figma.variables.createVariableCollection(TOKENS.collectionName);
const lightModeId = collection.modes[0].modeId;
collection.renameMode(lightModeId, "Light");
const darkModeId = Object.keys(TOKENS.dark).length > 0 ? collection.addMode("Dark") : undefined;
const variables = new Map();

for (const [name, value] of Object.entries(TOKENS.light)) {
  variables.set(name, createColorVariable(collection, lightModeId, name, value));
}

if (darkModeId) {
  for (const [name, value] of Object.entries(TOKENS.dark)) {
    const variable = variables.get(name) ?? createColorVariable(collection, lightModeId, name, TOKENS.light[name] ?? value);
    variables.set(name, variable);
    variable.setValueForMode(darkModeId, hexToRgb(value));
  }
}

figma.notify(\`Imported \${variables.size} color variables into \${TOKENS.collectionName}\`);
figma.closePlugin();
`,
    uiHtml: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <p>Run this plugin in Figma to import design tokens as color variables.</p>
  </body>
</html>
`,
  };
}
