import { posix } from "node:path";
import ts from "typescript";
import { parseSource } from "./parser.js";
import type { CodeEdge } from "./types.js";

interface ImportBinding {
  local: string;
  targetFile: string;
  exportedName: string;
}

interface IndexedFile {
  path: string;
  source: string;
  declaredNames: Set<string>;
  importBindings: ImportBinding[];
}

export function resolveImportPath(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return undefined;
  }

  const normalizedFromFile = fromFile.replaceAll("\\", "/");
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  let targetFile = posix.normalize(
    posix.join(posix.dirname(normalizedFromFile), normalizedSpecifier),
  );

  if (targetFile.endsWith(".js")) {
    targetFile = `${targetFile.slice(0, -3)}.ts`;
  } else if (posix.extname(targetFile) === "") {
    targetFile = `${targetFile}.ts`;
  }

  return targetFile;
}

export function collectImportBindings(filePath: string, source: string): ImportBinding[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const bindings: ImportBinding[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause === undefined ||
      statement.importClause.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }

    const targetFile = resolveImportPath(filePath, statement.moduleSpecifier.text);

    if (targetFile === undefined) {
      continue;
    }

    for (const element of statement.importClause.namedBindings.elements) {
      bindings.push({
        local: element.name.text,
        targetFile,
        exportedName: element.propertyName?.text ?? element.name.text,
      });
    }
  }

  return bindings;
}

export function buildCrossFileEdges(
  files: readonly { path: string; source: string }[],
): CodeEdge[] {
  const globalSymbols = new Set<string>();
  const indexedFiles: IndexedFile[] = [];

  for (const file of files) {
    const parsed = parseSource(file.path, file.source);
    const declaredNames = new Set<string>();

    for (const node of parsed.nodes) {
      declaredNames.add(node.name);
      globalSymbols.add(`${file.path}#${node.name}`);
    }

    indexedFiles.push({
      path: file.path,
      source: file.source,
      declaredNames,
      importBindings: collectImportBindings(file.path, file.source),
    });
  }

  const edges: CodeEdge[] = [];
  const importedFilePairs = new Set<string>();

  for (const file of indexedFiles) {
    const bindingsByLocal = new Map(
      file.importBindings.map((binding) => [binding.local, binding] as const),
    );

    for (const binding of file.importBindings) {
      const pairKey = `${file.path}\0${binding.targetFile}`;

      if (!importedFilePairs.has(pairKey)) {
        importedFilePairs.add(pairKey);
        edges.push({ from: file.path, to: binding.targetFile, kind: "imports" });
      }
    }

    const sourceFile = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true);
    collectImportedCallEdges(
      sourceFile,
      file.path,
      file.declaredNames,
      bindingsByLocal,
      globalSymbols,
      edges,
    );
  }

  return edges;
}

function collectImportedCallEdges(
  sourceFile: ts.SourceFile,
  filePath: string,
  declaredNames: Set<string>,
  bindingsByLocal: Map<string, ImportBinding>,
  globalSymbols: Set<string>,
  edges: CodeEdge[],
): void {
  const visit = (node: ts.Node, fromId: string | undefined): void => {
    if (isNamedFunctionDeclaration(node) || isNamedMethodDeclaration(node)) {
      if (node.body !== undefined) {
        visit(node.body, `${filePath}#${node.name.text}`);
      }
      return;
    }

    if (isAnonymousDefaultFunctionDeclaration(node)) {
      if (node.body !== undefined) {
        visit(node.body, `${filePath}#default`);
      }
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      visit(node.initializer.body, `${filePath}#${node.name.text}`);
      return;
    }

    if (
      ts.isExportAssignment(node) &&
      !node.isExportEquals &&
      (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression))
    ) {
      visit(node.expression.body, `${filePath}#default`);
      return;
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      visit(node.body, fromId ?? filePath);
      return;
    }

    if (fromId !== undefined && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const calleeName = node.expression.text;

      if (!declaredNames.has(calleeName)) {
        const binding = bindingsByLocal.get(calleeName);
        const targetId =
          binding === undefined ? undefined : `${binding.targetFile}#${binding.exportedName}`;

        if (targetId !== undefined && globalSymbols.has(targetId)) {
          edges.push({ from: fromId, to: targetId, kind: "calls" });
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, fromId));
  };

  visit(sourceFile, undefined);
}

function isNamedFunctionDeclaration(
  node: ts.Node,
): node is ts.FunctionDeclaration & { name: ts.Identifier } {
  return ts.isFunctionDeclaration(node) && node.name !== undefined;
}

function isAnonymousDefaultFunctionDeclaration(node: ts.Node): node is ts.FunctionDeclaration {
  return (
    ts.isFunctionDeclaration(node) &&
    node.name === undefined &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true
  );
}

function isNamedMethodDeclaration(node: ts.Node): node is ts.MethodDeclaration & { name: ts.Identifier } {
  return ts.isMethodDeclaration(node) && ts.isIdentifier(node.name);
}
