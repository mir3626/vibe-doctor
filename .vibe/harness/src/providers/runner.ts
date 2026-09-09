import type { ProviderExecutionInput, ProviderExecutionPlan } from './types.js';

function replaceTemplate(template: string, input: ProviderExecutionInput): string {
  const values: Record<string, string> = { prompt: input.prompt, promptFile: input.promptFile ?? '',
    cwd: input.cwd, role: input.role, model: input.model ?? '', taskId: input.taskId };
  // Substitute only the original template. Task text may itself contain braces
  // or replacement metacharacters; neither is an instruction to this renderer.
  return template.replace(/\{(prompt|promptFile|cwd|role|model|taskId)\}/g,
    (_match, key: string) => values[key]!);
}

export function buildExecutionPlan(input: ProviderExecutionInput): ProviderExecutionPlan {
  const templates = [...input.runner.args, ...Object.values(input.runner.env ?? {})];
  const modelTemplate = templates.some((value) => value.includes('{model}'));
  if (modelTemplate && !input.model) throw new Error('Runner {model} requires an explicit model or a registry-backed role');
  const plan = {
    command: input.runner.command,
    args: input.runner.args.map((value) => replaceTemplate(value, input)).filter(Boolean),
    env: Object.fromEntries(
      Object.entries(input.runner.env ?? {}).map(([key, value]) => [
        key,
        replaceTemplate(value, input),
      ]),
    ),
  };
  if (input.model && !modelTemplate) {
    if (input.provider !== 'codex' || !/(?:^|[/\\])run-codex\.(?:sh|cmd)$/i.test(input.runner.command)) {
      throw new Error('A model-selected custom runner must declare {model} in its arguments or environment');
    }
    // The canonical wrapper converts this default to a real child -m argument.
    // Provider-owned arguments/config/env remain authoritative over role defaults.
    if (!plan.env.CODEX_MODEL?.trim()) plan.env.CODEX_MODEL = input.model;
  }
  return plan;
}
