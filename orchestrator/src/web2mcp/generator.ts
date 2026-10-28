import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ActionSpecSchema, type ActionSpec, type ParamSpec, type Web2McpResult } from "./types.js";

const GENERATED_DEPS = {
  "@modelcontextprotocol/sdk": "^1.0.0",
  playwright: "^1.60.0",
} as const;

function toolName(id: string, used: Set<string>): string {
  const base =
    id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "action";

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function inputProperties(params: ParamSpec[]) {
  return Object.fromEntries(
    params.map((param) => [
      param.name,
      {
        type: param.type,
        description: `${param.in} parameter${param.required ? " (required)" : ""}`,
      },
    ]),
  );
}

function serverSource(specs: ActionSpec[]): string {
  const usedNames = new Set<string>();
  const tools = specs.map((spec) => ({
    ...spec,
    toolName: toolName(spec.id, usedNames),
    inputSchema: {
      type: "object",
      properties: inputProperties(spec.params),
      required: spec.params.filter((param) => param.required).map((param) => param.name),
      additionalProperties: false,
    },
  }));

  return `import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";

type ParamLocation = "body" | "query" | "form";
type ParamType = "string" | "number" | "boolean";
interface ParamSpec {
  name: string;
  type: ParamType;
  required: boolean;
  in: ParamLocation;
}
interface ActionSpec {
  id: string;
  kind: "form" | "network";
  title: string;
  target: { url: string; method: string };
  params: ParamSpec[];
  needsAuth: boolean;
  toolName: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: ParamType; description: string }>;
    required: string[];
    additionalProperties: boolean;
  };
}

const specs: ActionSpec[] = ${JSON.stringify(tools, null, 2)};

function storageStatePath(): string | undefined {
  return process.env.WEB2MCP_STORAGE_STATE || process.env.PLAYWRIGHT_STORAGE_STATE;
}

async function storageCookies(): Promise<string> {
  const statePath = storageStatePath();
  if (!statePath) return "";
  const raw = await readFile(statePath, "utf8");
  const parsed = JSON.parse(raw) as { cookies?: Array<{ name: string; value: string }> };
  return (parsed.cookies ?? []).map((cookie) => \`\${cookie.name}=\${cookie.value}\`).join("; ");
}

function valueMap(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

async function runFormAction(spec: ActionSpec, args: unknown): Promise<string> {
  const values = valueMap(args);
  const browser = await chromium.launch();
  const context = await browser.newContext(
    storageStatePath() ? { storageState: storageStatePath() } : undefined,
  );
  const page = await context.newPage();
  try {
    await page.goto(spec.target.url, { waitUntil: "domcontentloaded" });
    for (const param of spec.params.filter((param) => param.in === "form")) {
      const value = values[param.name];
      if (value === undefined || value === null) continue;
      const selector = \`[name="\${param.name.replace(/"/g, "\\\\\\"")}"]\`;
      if (param.type === "boolean") {
        await page.setChecked(selector, Boolean(value));
      } else {
        await page.fill(selector, String(value));
      }
    }
    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => undefined),
      page.locator("form").first().evaluate((form) => {
        if (form instanceof HTMLFormElement) form.requestSubmit();
      }),
    ]);
    return \`Submitted \${spec.title}; final URL: \${page.url()}\`;
  } finally {
    await context.close().catch((error: unknown) => {
      console.warn("生成工具浏览器上下文关闭失败", { targetUrl: spec.target.url, error });
    });
    await browser.close().catch((error: unknown) => {
      console.warn("生成工具浏览器关闭失败", { targetUrl: spec.target.url, error });
    });
  }
}

async function runNetworkAction(spec: ActionSpec, args: unknown): Promise<string> {
  const values = valueMap(args);
  const url = new URL(spec.target.url);
  const body: Record<string, unknown> = {};

  for (const param of spec.params) {
    const value = values[param.name];
    if (value === undefined || value === null) continue;
    if (param.in === "query") url.searchParams.set(param.name, String(value));
    if (param.in === "body") body[param.name] = value;
  }

  const headers: Record<string, string> = {};
  const cookie = await storageCookies();
  if (cookie) headers.cookie = cookie;
  if (Object.keys(body).length > 0) headers["content-type"] = "application/json";

  const response = await fetch(url, {
    method: spec.target.method,
    headers,
    body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return \`\${response.status} \${response.statusText}\\n\${text}\`;
}

const server = new Server(
  { name: "web2mcp-generated", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: specs.map((spec) => ({
    name: spec.toolName,
    description: spec.title,
    inputSchema: spec.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const spec = specs.find((candidate) => candidate.toolName === request.params.name);
  if (!spec) throw new Error(\`Unknown tool: \${request.params.name}\`);
  const text = spec.kind === "form"
    ? await runFormAction(spec, request.params.arguments)
    : await runNetworkAction(spec, request.params.arguments);
  return { content: [{ type: "text", text }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
`;
}

function packageJson() {
  return `${JSON.stringify(
    {
      name: "web2mcp-generated-server",
      version: "0.1.0",
      type: "module",
      private: true,
      scripts: {
        build: "tsc -p tsconfig.json",
        start: "node dist/server.js",
      },
      dependencies: GENERATED_DEPS,
      devDependencies: {
        typescript: "^5.6.0",
        "@types/node": "^20.0.0",
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfigJson() {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        outDir: "dist",
        strict: true,
        skipLibCheck: true,
      },
      include: ["server.ts"],
    },
    null,
    2,
  )}\n`;
}

function readme(specs: ActionSpec[]) {
  return `# Generated web2mcp server

This directory contains a standalone MCP server generated from ${specs.length} discovered web action(s).

## Install

\`\`\`sh
npm install
npm run build
\`\`\`

## Auth

If the target site needs login, create a Playwright storage state with:

\`\`\`sh
kunpeng web2mcp-login <url> --out storageState.json
\`\`\`

Then run the server with:

\`\`\`sh
WEB2MCP_STORAGE_STATE=./storageState.json npm start
\`\`\`

Add this directory's start command to your MCP client configuration. Tools are generated from \`actions.json\`.
`;
}

export async function emitMcpServer(
  specs: ActionSpec[],
  outDir: string,
): Promise<Web2McpResult> {
  if (specs.length === 0) throw new Error("web2mcp generator requires at least one ActionSpec");
  const parsed = z.array(ActionSpecSchema).parse(specs);
  const resolvedOutDir = path.resolve(outDir);

  await mkdir(resolvedOutDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(resolvedOutDir, "server.ts"), serverSource(parsed)),
    writeFile(path.join(resolvedOutDir, "package.json"), packageJson()),
    writeFile(path.join(resolvedOutDir, "tsconfig.json"), tsconfigJson()),
    writeFile(path.join(resolvedOutDir, "actions.json"), `${JSON.stringify(parsed, null, 2)}\n`),
    writeFile(path.join(resolvedOutDir, "README.md"), readme(parsed)),
  ]);

  return { outDir: resolvedOutDir, tools: parsed.length, specs: parsed };
}
