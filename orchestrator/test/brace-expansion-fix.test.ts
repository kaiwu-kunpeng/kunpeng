import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lockPath = fileURLToPath(new URL('../package-lock.json', import.meta.url));
const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
  packages?: Record<string, { version?: string; resolved?: string }>;
};

function gte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

const entries = Object.entries(lock.packages ?? {}).filter(
  ([k]) =>
    k === 'node_modules/brace-expansion' || k.endsWith('/node_modules/brace-expansion'),
);

describe('brace-expansion 漏洞修复 (GHSA-3jxr / GHSA-mh99 / GHSA-rgw5, high)', () => {
  it('lockfile 中存在 brace-expansion 条目', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('每个 brace-expansion 都被解析到已修补版本 (>= 5.0.9)', () => {
    for (const [key, meta] of entries) {
      expect(meta.version, `${key} version 缺失`).toBeDefined();
      expect(
        gte(meta.version!, '5.0.9'),
        `${key} 当前为 ${meta.version}，必须 >= 5.0.9`,
      ).toBe(true);
    }
  });

  it('resolved tarball 必须与声明的 version 一致（禁止手改版本号）', () => {
    for (const [key, meta] of entries) {
      expect(meta.resolved, `${key} resolved 缺失`).toBeTruthy();
      expect(
        meta.resolved!,
        `${key} 的 resolved 必须引用 brace-expansion-${meta.version}.tgz`,
      ).toContain(`brace-expansion-${meta.version}.tgz`);
    }
  });
});