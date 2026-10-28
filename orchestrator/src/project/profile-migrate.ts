import { join } from "node:path";

export interface MigrationPlan {
  needed: boolean;
  moves: { from: string; to: string }[];
  loopsToFlag: string[];
}

export interface MigrationInput {
  stateDir: string;
  hasProfilesDir: boolean;
  hasLegacyProjects: boolean;
  legacyLoopIds: string[];
}

export function planMigration(input: MigrationInput): MigrationPlan {
  if (input.hasProfilesDir) {
    return { needed: false, moves: [], loopsToFlag: [] };
  }

  const moves: { from: string; to: string }[] = [];
  if (input.hasLegacyProjects) {
    moves.push({
      from: join(input.stateDir, "projects.json"),
      to: join(input.stateDir, "profiles", "home", "projects.json"),
    });
  }
  moves.push(
    { from: join(input.stateDir, "switchboard"), to: join(input.stateDir, "shared", "switchboard") },
    { from: join(input.stateDir, "presence"), to: join(input.stateDir, "shared", "presence") },
  );

  return {
    needed: input.hasLegacyProjects || input.legacyLoopIds.length > 0,
    moves,
    loopsToFlag: [...input.legacyLoopIds],
  };
}
