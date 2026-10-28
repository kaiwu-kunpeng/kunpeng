export function parseSymbolicRefBranch(out: string): string | null {
  const match = out.trim().match(/refs\/remotes\/[^/]+\/(.+)$/);
  return match?.[1] ?? null;
}

export interface ResolveDefaultBranchDeps {
  symbolicRef: () => Promise<string>;
  fallback: string;
}

export async function resolveDefaultBranch(deps: ResolveDefaultBranchDeps): Promise<string> {
  try {
    const out = await deps.symbolicRef();
    return parseSymbolicRefBranch(out) ?? deps.fallback;
  } catch {
    return deps.fallback;
  }
}
