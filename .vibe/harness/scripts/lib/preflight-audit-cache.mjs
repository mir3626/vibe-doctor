import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Only static audits use this cache. Mutable project state/environment checks stay live.
export function auditInputHash(root, inputs) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([process.version, process.execPath, process.platform, process.arch, path.resolve(root)]));
  function visit(relative) {
    const file = path.join(root, relative);
    hash.update(relative + '\0');
    if (!existsSync(file)) { hash.update('missing\0'); return; }
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`uncacheable audit symlink: ${relative}`);
    if (stat.isDirectory()) for (const name of readdirSync(file).sort()) visit(path.join(relative, name));
    else { hash.update(readFileSync(file)); hash.update('\0'); }
  }
  for (const input of [...inputs].sort()) visit(input);
  return hash.digest('hex');
}

export function runCachedAudits({ root, inputs, results, run, force = false }) {
  let key;
  try { key = auditInputHash(root, inputs); } catch { run(); return 'uncacheable'; }
  const target = path.join(root, '.vibe/runs/preflight-audits', `${key}.json`);
  if (!force) {
    try {
      const receipt = JSON.parse(readFileSync(target, 'utf8'));
      if (receipt.schema === 'vibe-static-audits-v1' && receipt.key === key
        && Array.isArray(receipt.results) && receipt.results.length > 0
        && receipt.results.every((entry) => typeof entry.id === 'string' && entry.ok === true
          && typeof entry.detail === 'string' && ['ok', 'warn', 'info'].includes(entry.level))) {
        results.push(...receipt.results);
        return 'reused';
      }
    } catch { /* absent, torn or invalid receipt: run again */ }
  }
  const start = results.length;
  run();
  const captured = results.slice(start);
  try {
    if (captured.length && captured.every((entry) => entry.ok === true) && auditInputHash(root, inputs) === key) {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify({ schema: 'vibe-static-audits-v1', key, results: captured }) + '\n', 'utf8');
    }
  } catch { return 'uncacheable'; } // Read-only cache storage cannot invalidate completed audits.
  return 'ran';
}
