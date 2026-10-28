import ts from "typescript";
import type { CodeEdge, CodeNode } from "./types.js";

export interface ParseResult {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

interface DeclarationInfo {
  id: string;
  name: string;
  node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;
}

export function parseSource(filePath: string, source: string): ParseResult {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const declarationsByName = new Map<string, string>();
  const callableDeclarations: DeclarationInfo[] = [];

  const collectDeclaration = (node: ts.Node): void => {
    if (isNamedClassDeclaration(node)) {
      const name = node.name.text;
      const id = nodeId(filePath, name);
      nodes.push(createCodeNode(sourceFile, filePath, node, name, "class", id));
      declarationsByName.set(name, id);
    } else if (isNamedFunctionDeclaration(node) || isNamedMethodDeclaration(node)) {
      const name = node.name.text;
      const id = nodeId(filePath, name);
      nodes.push(createCodeNode(sourceFile, filePath, node, name, "function", id));
      declarationsByName.set(name, id);
      callableDeclarations.push({ id, name, node });
    } else if (isAnonymousDefaultFunctionDeclaration(node)) {
      const name = "default";
      const id = nodeId(filePath, name);
      nodes.push(createCodeNode(sourceFile, filePath, node, name, "function", id));
      declarationsByName.set(name, id);
      callableDeclarations.push({ id, name, node });
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const name = node.name.text;
      const id = nodeId(filePath, name);
      nodes.push(createCodeNode(sourceFile, filePath, node, name, "function", id));
      declarationsByName.set(name, id);
      callableDeclarations.push({ id, name, node: node.initializer });
    } else if (
      ts.isExportAssignment(node) &&
      !node.isExportEquals &&
      (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression))
    ) {
      const name = "default";
      const id = nodeId(filePath, name);
      nodes.push(createCodeNode(sourceFile, filePath, node, name, "function", id));
      declarationsByName.set(name, id);
      callableDeclarations.push({ id, name, node: node.expression });
    }

    ts.forEachChild(node, collectDeclaration);
  };

  collectDeclaration(sourceFile);

  for (const declaration of callableDeclarations) {
    const body = declaration.node.body;

    if (body === undefined) {
      continue;
    }

    collectCallEdges(body, declaration.id, declarationsByName, edges);
  }

  return { nodes, edges };
}

function createCodeNode(
  sourceFile: ts.SourceFile,
  filePath: string,
  node: ts.Node,
  name: string,
  kind: CodeNode["kind"],
  id: string,
): CodeNode {
  return {
    id,
    kind,
    name,
    file: filePath,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
  };
}

function collectCallEdges(
  node: ts.Node,
  fromId: string,
  declarationsByName: Map<string, string>,
  edges: CodeEdge[],
): void {
  if (ts.isCallExpression(node)) {
    const calleeName = callExpressionName(node);
    const toId = calleeName === undefined ? undefined : declarationsByName.get(calleeName);

    if (toId !== undefined) {
      edges.push({ from: fromId, to: toId, kind: "calls" });
    }
  }

  ts.forEachChild(node, (child) => collectCallEdges(child, fromId, declarationsByName, edges));
}

function callExpressionName(node: ts.CallExpression): string | undefined {
  const expression = node.expression;

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return undefined;
}

function isNamedClassDeclaration(node: ts.Node): node is ts.ClassDeclaration & { name: ts.Identifier } {
  return ts.isClassDeclaration(node) && node.name !== undefined;
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

function nodeId(filePath: string, name: string): string {
  return `${filePath}#${name}`;
}
