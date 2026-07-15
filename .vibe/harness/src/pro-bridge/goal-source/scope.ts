import type { GoalSourceManifest } from '../../lib/schemas/pro-bridge.js';
import { compareStringsByCodePoint } from '../contract.js';

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareStringsByCodePoint);
}

function scopeGlob(filePath: string): string {
  const segments = filePath.split('/');
  if (segments.length >= 3) {
    return `${segments.slice(0, 2).join('/')}/**`;
  }
  if (segments.length === 2) {
    return `${segments[0]}/**`;
  }
  return filePath;
}

export function classifyScope(changedFiles: string[]): GoalSourceManifest['scope'] {
  const normalized = uniqueSorted(
    changedFiles.filter((filePath) => filePath.length > 0).map((filePath) => filePath.replaceAll('\\', '/')),
  );
  const codeFiles: string[] = [];
  const testFiles: string[] = [];
  const migrationFiles: string[] = [];
  const docsFiles: string[] = [];

  for (const filePath of normalized) {
    const segments = filePath.split('/');
    const fileName = segments.at(-1) ?? filePath;
    if (
      segments.some((segment) => ['test', 'tests', '__tests__', 'e2e'].includes(segment)) ||
      /\.(?:test|spec)\.[^/]+$/.test(fileName)
    ) {
      testFiles.push(filePath);
    } else if (segments.includes('migrations') || fileName.endsWith('.sql')) {
      migrationFiles.push(filePath);
    } else if (segments[0] === 'docs' || /\.mdx?$/.test(fileName)) {
      docsFiles.push(filePath);
    } else {
      codeFiles.push(filePath);
    }
  }

  return {
    changedFiles: normalized,
    codeFiles,
    testFiles,
    migrationFiles,
    docsFiles,
    scopeGlobs: uniqueSorted(normalized.map(scopeGlob)),
  };
}
