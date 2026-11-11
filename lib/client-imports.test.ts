import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

/** Modules that use Node APIs (fs, server keys…): a client bundle that pulls them in breaks the build. */
const SERVER_ONLY = [
  '@/lib/themes/themes',
  '@/lib/catalog/',
  '@/lib/rooms/room-repo',
  '@/lib/rooms/room-service',
  '@/lib/supabase/server',
  '@/lib/supabase/admin',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('client modules', () => {
  it('do not import server-only modules at runtime (type imports are fine)', () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'lib'))]) {
      const src = readFileSync(file, 'utf8');
      if (!/^['"]use client['"]/.test(src.trimStart())) continue;
      for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gms)) {
        if (SERVER_ONLY.some((s) => m[1].startsWith(s))) offenders.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
