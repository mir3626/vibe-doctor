#!/usr/bin/env node
// Common Windows transport. Prompt construction remains the wrapper's responsibility.
import { codexInvocationProfile } from '../src/lib/harness-profile.mjs';
import { runCodexProcess } from './lib/codex-process.mjs';

const args = process.argv.slice(2);
const policy = codexInvocationProfile(args, process.env);
const env = { ...process.env, VIBE_ACTIVE_MODEL: '', VIBE_ACTIVE_PROVIDER: 'codex',
  PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
// Skip flag operands so a path or prompt containing flag text is never an override.
let hasModel = false, hasSandbox = false;
const operands = new Set(['-m', '--model', '-s', '--sandbox', '-c', '--config', '-p', '--profile',
  '-C', '--cd', '-i', '--image', '-o', '--output-last-message', '--output-schema', '--color',
  '--add-dir', '--enable', '--disable', '--thread-source', '--local-provider']);
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--') break;
  if (arg === '--model' || arg.startsWith('--model=') || /^-m/.test(arg)) hasModel = true;
  if (arg === '--sandbox' || arg.startsWith('--sandbox=') || /^-s/.test(arg)) hasSandbox = true;
  if (operands.has(arg)) index++;
}
const defaults = ['exec'];
if (!hasSandbox) defaults.push('-s', process.env.CODEX_SANDBOX || 'workspace-write');
if (!hasModel && process.env.CODEX_MODEL) defaults.push('-m', process.env.CODEX_MODEL);
process.stderr.write(`[run-codex] ${JSON.stringify({ ...policy, profile: 'legacy', attempts: 1, effectiveStatus: 'unconfirmed' })}\n`);
try { process.exitCode = await runCodexProcess([...defaults, ...args], { env }); }
catch (error) { process.stderr.write(`run-codex: ${error.message}\n`); process.exitCode = 1; }
