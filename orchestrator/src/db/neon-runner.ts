import { createRequire } from "node:module";

export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

type NeonClient = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
};

type NeonFactory = (connStr: string) => NeonClient;

type NeonModule = {
  neon: NeonFactory;
};

function splitSqlStatements(sqlText: string): string[] {
  return sqlText
    .split(/;\s*(?:\n|$)/)
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}

function loadNeonModule(): NeonModule {
  const require = createRequire(import.meta.url);
  const mod = require("@neondatabase/serverless") as Partial<NeonModule>;
  if (typeof mod.neon !== "function") {
    throw new Error("neonRunner: @neondatabase/serverless missing neon export");
  }
  return { neon: mod.neon };
}

export function neonRunner(
  connStr: string,
  neonFactory?: NeonFactory,
): SqlRunner {
  if (typeof connStr !== "string" || connStr.trim() === "") {
    throw new Error("neonRunner: connStr is required");
  }

  const neon = neonFactory ?? loadNeonModule().neon;
  const client = neon(connStr);
  return {
    async query(querySql: string, params?: unknown[]): Promise<unknown> {
      const statements = splitSqlStatements(querySql);
      let result: unknown = [];
      for (const statement of statements) {
        result =
          params === undefined
            ? await client.query(statement)
            : await client.query(statement, params);
      }
      return result;
    },
  };
}
