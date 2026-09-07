import { readFileSync } from 'node:fs';
import path from 'node:path';

// Eligibility is explicit, never an ordering comparison on a model name.
export function resolveHarnessProfile({ model, provider = 'codex', override, registry } = {}) {
  const requestedModel = typeof model === 'string' && model.trim() ? model.trim() : null;
  const entry = Object.values(registry?.schemaVersion === 1 ? registry?.providers?.[provider]?.knownModels ?? {} : {})
    .find((candidate) => candidate && typeof candidate === 'object' && candidate.apiId === requestedModel);
  const knownLower = /^(?:gpt-[0-5](?:[.-]|$)|gpt-6-(?:luna|sol|terra|mini|nano)(?:-|$))/.test(requestedModel ?? '');
  const eligible = provider === 'codex' && (requestedModel === 'gpt-6-astra'
    || (!knownLower && requestedModel !== null && entry?.harnessProfile === 'astra'));
  const profile = eligible && override !== 'legacy' ? 'astra' : 'legacy';
  return { profile, requestedModel, effectiveModel: null, effectiveEffort: null,
    reason: override === 'legacy' ? 'explicit-legacy' : eligible ? 'verified-model' : 'lower-or-unknown-model' };
}

export function runtimeHarnessProfile(env = process.env, root = process.cwd()) {
  let registry;
  try { registry = JSON.parse(readFileSync(path.join(root, '.vibe/model-registry.json'), 'utf8')); } catch { /* unknown stays legacy */ }
  return resolveHarnessProfile({ model: env.VIBE_ACTIVE_MODEL, provider: env.VIBE_ACTIVE_PROVIDER ?? 'codex',
    override: env.VIBE_HARNESS_PROFILE, registry });
}

// Wrapper arguments select the CHILD model. Never inherit a parent's active-model claim.
export function codexInvocationProfile(args, env = process.env, registry) {
  let model = env.CODEX_MODEL;
  let effort = null;
  let opaqueConfig = false;
  let cliModel;
  let configModel;
  const otherOperands = new Set(['-s', '--sandbox', '-C', '--cd', '-i', '--image', '-o', '--output-last-message', '--output-schema', '--color', '--add-dir', '--enable', '--disable', '--thread-source', '--local-provider']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') break;
    if (arg === '--oss' || arg === '--local-provider' || arg.startsWith('--local-provider=')) opaqueConfig = true;
    if (otherOperands.has(arg)) { index++; continue; }
    if (arg === '-m' || arg === '--model') cliModel = args[++index];
    else if (arg.startsWith('--model=')) cliModel = arg.slice(8);
    else if (arg.startsWith('-m') && !arg.startsWith('--')) cliModel = arg.slice(2);
    else if (arg === '-p' || arg === '--profile' || arg.startsWith('--profile=') || (arg.startsWith('-p') && !arg.startsWith('--'))) opaqueConfig = true;
    else if (arg === '-c' || arg === '--config' || arg.startsWith('--config=') || (arg.startsWith('-c') && !arg.startsWith('--'))) {
      const value = arg.startsWith('--config=') ? arg.slice(9) : arg.length > 2 && !arg.startsWith('--') ? arg.slice(2) : args[++index] ?? '';
      if (/^["']/.test(value.trim())) opaqueConfig = true;
      if (/^model\s*=/.test(value)) configModel = value.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '');
      if (/^model_reasoning_effort\s*=/.test(value)) effort = value.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '');
      if (/^(model_provider|profile)\s*=/.test(value)) opaqueConfig = true;
    }
  }
  model = cliModel ?? configModel ?? model;
  if (cliModel && configModel && cliModel !== configModel) opaqueConfig = true;
  // Multiple configuration authorities are not reliable evidence of the executed model.
  if (opaqueConfig || env.CODEX_EXTRA_CONFIG) model = undefined;
  return { ...resolveHarnessProfile({ model, override: env.VIBE_HARNESS_PROFILE, registry }), requestedEffort: effort };
}
