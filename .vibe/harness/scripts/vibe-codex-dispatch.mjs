#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexInvocationProfile } from '../src/lib/harness-profile.mjs';
import { runCodexProcess } from './lib/codex-process.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rawArgs = process.argv.slice(2);
const probe = rawArgs[0] === '--profile-only';
if (probe) rawArgs.shift();
let registry;
try { registry = JSON.parse(readFileSync('.vibe/model-registry.json', 'utf8')); } catch { /* no registry */ }
const policy = codexInvocationProfile(rawArgs, process.env, registry);
if (probe) {
  process.stdout.write(policy.profile + '\n');
} else {
  try { await main(); } catch (error) { process.stderr.write(`run-codex: ${error.message}\n`); process.exitCode = 1; }
}

async function main() {
  if (policy.profile !== 'astra') throw new Error('Astra dispatcher requires a verified child model; use run-codex for legacy models');
  const diagnostic = rawArgs.includes('--diagnose-md-injection') || rawArgs.includes('--dry-run-md-injection');
  const args = rawArgs.filter((arg) => !['--diagnose-md-injection', '--dry-run-md-injection'].includes(arg));
  const rulesPath = path.resolve(scriptDir, '../../agent/astra-rules.md');
  const rules = readFileSync(rulesPath, 'utf8');
  // Positional prompts are converted to stdin to preserve Unicode and shell metacharacters.
  // Options with operands must not be mistaken for prompts.
  const operandOptions = new Set(['-m', '--model', '-c', '--config', '-s', '--sandbox', '-C', '--cd', '-i', '--image', '-o', '--output-last-message', '--output-schema', '--color', '--add-dir', '--enable', '--disable', '--thread-source']);
  const cli = [];
  let sandbox = process.env.CODEX_SANDBOX || 'workspace-write';
  let prompt;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-m' || arg === '--model') { index++; continue; }
    if (arg.startsWith('--model=') || (arg.startsWith('-m') && !arg.startsWith('--'))) continue;
    if (arg === '-s' || arg === '--sandbox') { sandbox = args[++index]; continue; }
    if (arg.startsWith('--sandbox=')) { sandbox = arg.slice(10); continue; }
    if (arg.startsWith('-s') && !arg.startsWith('--')) { sandbox = arg.slice(2); continue; }
    if (operandOptions.has(arg)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`Missing operand for ${arg}`);
      cli.push(arg, value); continue;
    }
    if (arg === '-') { prompt = readFileSync(0, 'utf8'); continue; }
    if (arg === '--') { prompt = args.slice(index + 1).join(' '); break; }
    if (arg.startsWith('-')) { cli.push(arg); continue; }
    if (arg === 'resume' || arg === 'review') throw new Error('Use native codex exec resume/review directly; the task wrapper does not restart or reconstruct sessions');
    if (prompt !== undefined) throw new Error('Multiple positional prompts; pass one quoted prompt or stdin');
    prompt = arg;
  }
  if (prompt === undefined) throw new Error('Provide a prompt or stdin (-)');
  const payload = `${rules}\n\n--- Task ---\n${prompt}`;
  if (diagnostic) {
    process.stdout.write(JSON.stringify({ ...policy, promptSource: rawArgs.includes('-') ? 'stdin' : 'argv',
      injectedFiles: ['.vibe/agent/astra-rules.md'], injectedBytes: Buffer.byteLength(rules),
      windowsSandboxHeaderInjected: false, retrieval: 'on-demand', payload }, null, 2) + '\n');
    return;
  }
  const env = { ...process.env, VIBE_ACTIVE_MODEL: policy.requestedModel, VIBE_ACTIVE_PROVIDER: 'codex',
    PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', LANG: process.env.LANG || 'C.UTF-8', LC_ALL: process.env.LC_ALL || 'C.UTF-8' };
  const base = ['exec', '-s', sandbox];
  base.push('-m', policy.requestedModel);
  base.push('-c', 'shell_environment_policy.inherit="all"', '-c', 'shell_environment_policy.set={PYTHONIOENCODING="utf-8",PYTHONUTF8="1"}');
  process.stderr.write(`[run-codex] ${JSON.stringify({ ...policy, attempts: 1, effectiveStatus: 'unconfirmed' })}\n`);
  const code = await runCodexProcess([...base, ...cli, '-'], { env, payload });
  // A failed task may already have side effects. Native retries/resume own recovery.
  process.exitCode = code;
}
