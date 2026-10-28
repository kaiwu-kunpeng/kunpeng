import { expect, test } from "vitest";

import { toFigmaVariablePlugin, toShadcnRegistryItem, toTokensStudio } from "../../src/design/design-export.js";

const tk = {
  light: {
    primary: { $value: "#9f2000" },
    background: { $value: "#fff7f2" },
  },
  dark: {
    primary: { $value: "#ff8a65" },
    background: { $value: "#380600" },
  },
};

test("exports DTCG tokens as a shadcn registry theme item", () => {
  const item = toShadcnRegistryItem("kunpeng", tk);

  expect(item.name).toBe("kunpeng");
  expect(item.type).toBe("registry:theme");
  expect(item.cssVars.light.primary).toBe("#9f2000");
  expect(item.cssVars.dark.background).toBe("#380600");
  expect(toShadcnRegistryItem("", tk).name).toBe("design");
});

test("exports DTCG tokens as Tokens Studio color sets", () => {
  const tokenSet = toTokensStudio(tk);

  expect(tokenSet.light.primary.value).toBe("#9f2000");
  expect(tokenSet.light.primary.type).toBe("color");
  expect(tokenSet.dark.background.value).toBe("#380600");
});

test("exports a runnable Figma Variables plugin package", () => {
  const plugin = toFigmaVariablePlugin("kunpeng", tk);

  expect(plugin.manifest).toEqual({
    name: "kunpeng Design Tokens",
    api: "1.0.0",
    main: "code.js",
    ui: "ui.html",
    editorType: ["figma"],
  });
  expect(plugin.code).toContain("figma.variables.createVariableCollection");
  expect(plugin.code).toContain('figma.variables.createVariable(name, collection, "COLOR")');
  expect(plugin.code).toContain('"primary": "#9f2000"');
  expect(plugin.code).toContain('"background": "#380600"');
  expect(plugin.code).toContain('collection.renameMode(lightModeId, "Light")');
  expect(plugin.code).toContain('collection.addMode("Dark")');
  expect(plugin.uiHtml).toContain("<!doctype html>");
});
