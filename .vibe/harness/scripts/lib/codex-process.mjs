import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function codexExecutable(env = process.env) {
  const bin = env.CODEX_BIN;
  if (bin && /\.[cm]?js$/i.test(bin)) return [process.execPath, [bin]];
  if (process.platform !== 'win32' || (bin && !/\.(cmd|bat|ps1)$/i.test(bin))) return [bin ?? 'codex', []];
  const candidates = bin ? [bin] : (spawnSync('where.exe', ['codex'], { env, encoding: 'utf8', windowsHide: true }).stdout ?? '').trim().split(/\r?\n/);
  for (const candidate of candidates) {
    if (/\.exe$/i.test(candidate)) return [candidate, []];
    const js = path.join(path.dirname(candidate), 'node_modules/@openai/codex/bin/codex.js');
    if (existsSync(js)) return [process.execPath, [js]];
  }
  throw new Error('Cannot resolve a shell-free Codex executable. Set CODEX_BIN to codex.exe or the Codex bin/codex.js entry.');
}

export async function runCodexProcess(args, { env = process.env, payload } = {}) {
  const [command, prefix] = codexExecutable(env);
  const child = spawn(command, [...prefix, ...args], {
    env, stdio: [payload === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'], windowsHide: true,
  });
  if (payload !== undefined) {
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') process.stderr.write(error.message + '\n'); });
    child.stdin.end(payload, 'utf8');
  }
  // Never replay an entire task: an unsuccessful process may have made changes.
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve(status ?? (signal ? 130 : 1)));
  });
}
