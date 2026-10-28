import { exec } from "node:child_process";

export interface ReleaseResult extends Record<string, unknown> { released: boolean; version: string; output: string; exitCode: number; }

export function releaseArtifactFrom(
  r: { released: boolean; output?: string } & Record<string, unknown>,
  version: string,
  buildCmd: string,
): {
  kind: "release";
  id: string;
  status: "draft" | "rolled-back";
  body: string;
  meta: Record<string, unknown>;
} {
  return {
    kind: "release",
    id: `release-${version}`,
    status: r.released ? "draft" : "rolled-back",
    body: `build: ${buildCmd}\nreleased: ${r.released}`,
    meta: { ...r },
  };
}

export function runBuildRelease(cwd: string, buildCmd: string, version: string): Promise<ReleaseResult> {
  return new Promise((resolve) => {
    exec(buildCmd, {
      cwd,
      shell: "/bin/bash",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 600_000,
    }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      const exitCode = err && typeof (err as { code?: number }).code === "number" ? (err as { code?: number }).code! : err ? 1 : 0;
      resolve({ released: exitCode === 0, version, output, exitCode });
    });
  });
}
