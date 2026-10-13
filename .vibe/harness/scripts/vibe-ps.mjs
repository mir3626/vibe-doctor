#!/usr/bin/env node
// Runs PowerShell deterministically: the code comes from a file (or one -c string) and every piece of data —
// text, paths, names — comes in as arguments, named parameters or environment variables, never pasted into
// the code. Inline `powershell -Command "..."` breaks three ways: the calling shell and PowerShell both parse
// the same string (quotes, `$`, backticks, spaces), PowerShell reads typographic quotes as quotes and en/em
// dashes as '-', and Windows PowerShell 5.1 reads a BOM-less .ps1 in the ANSI code page. Here the code is read
// as UTF-8 by an ASCII-only bootstrap run with `-File`, the data travels in environment variables as JSON, and
// typographic quotes/dashes outside comments are refused before anything runs.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const BOOTSTRAP_PATH = path.join(scriptDir, 'lib', 'vibe-ps-bootstrap.ps1');
export const USAGE_EXIT = 64;
const NOT_FOUND_EXIT = 127;

export function usage() {
  return [
    'Usage: node .vibe/harness/scripts/vibe-ps.mjs [options] <script.ps1> [--] [arg...]',
    '       node .vibe/harness/scripts/vibe-ps.mjs [options] -c <code> [--] [arg...]',
    '',
    'Runs PowerShell code with all data passed as data. Everything after the script (or -c <code>) is a',
    'positional argument, passed through unchanged.',
    '',
    '  --param <Name>=<value>       named parameter (-Name value); --param <Name> alone passes a switch',
    '  --param-file <Name>=<path>   named parameter whose value is the UTF-8 text of <path>',
    '  --env <NAME>=<value>         environment variable for the script',
    '  --shell <auto|pwsh|powershell>  auto (default): pwsh when it is on PATH, else Windows PowerShell 5.1',
    '  --cwd <dir>                  working directory (default: the current one)',
    '  --check                      parse and check the code only; run nothing',
    '  --allow-typographic          allow typographic quotes/dashes outside comments',
    '  --help                       print this message',
    '',
    'Exit codes: the script\'s own `exit N`; 1 when an error stops it ($ErrorActionPreference is Stop);',
    '0 when it ends; 65 when the code does not parse or carries typographic quotes/dashes outside comments;',
    `${USAGE_EXIT} for a usage error; ${NOT_FOUND_EXIT} when no PowerShell is found.`,
    '',
  ].join('\n');
}

class UsageError extends Error {}

function splitPair(option, value, { allowBare = false } = {}) {
  if (value === undefined) {
    throw new UsageError(`${option} needs a value`);
  }
  const at = value.indexOf('=');
  if (at === -1) {
    if (allowBare && value.length > 0) {
      return [value, null];
    }
    throw new UsageError(`${option} expects <name>=<value>, got "${value}"`);
  }
  const name = value.slice(0, at);
  if (name.length === 0) {
    throw new UsageError(`${option} expects <name>=<value>, got "${value}"`);
  }
  return [name, value.slice(at + 1)];
}

/** Reads the command line into a plan. Options stop at the script path or -c; the rest are arguments. */
export function parseArgs(argv) {
  const plan = {
    file: null,
    code: null,
    args: [],
    params: {},
    paramFiles: {},
    env: {},
    shell: 'auto',
    cwd: null,
    check: false,
    allowTypographic: false,
    help: false,
  };
  let index = 0;
  while (index < argv.length) {
    const option = argv[index];
    index += 1;
    if (option === '--help' || option === '-h') {
      plan.help = true;
      return plan;
    }
    if (option === '--check') {
      plan.check = true;
    } else if (option === '--allow-typographic') {
      plan.allowTypographic = true;
    } else if (option === '--param') {
      const [name, value] = splitPair(option, argv[index], { allowBare: true });
      index += 1;
      plan.params[name] = value === null ? true : value;
    } else if (option === '--param-file') {
      const [name, value] = splitPair(option, argv[index]);
      index += 1;
      plan.paramFiles[name] = value;
    } else if (option === '--env') {
      const [name, value] = splitPair(option, argv[index]);
      index += 1;
      plan.env[name] = value;
    } else if (option === '--shell') {
      const value = argv[index];
      index += 1;
      if (!['auto', 'pwsh', 'powershell'].includes(value ?? '')) {
        throw new UsageError('--shell expects auto, pwsh or powershell');
      }
      plan.shell = value;
    } else if (option === '--cwd') {
      if (argv[index] === undefined) {
        throw new UsageError('--cwd needs a directory');
      }
      plan.cwd = argv[index];
      index += 1;
    } else if (option === '-c' || option === '--code') {
      if (argv[index] === undefined) {
        throw new UsageError(`${option} needs the code`);
      }
      plan.code = argv[index];
      index += 1;
      break;
    } else if (option.startsWith('-')) {
      throw new UsageError(`unknown option ${option}`);
    } else {
      plan.file = option;
      break;
    }
  }
  if (plan.file === null && plan.code === null) {
    throw new UsageError('give a script path or -c <code>');
  }
  const rest = argv.slice(index);
  plan.args = rest[0] === '--' ? rest.slice(1) : rest;
  return plan;
}

function onPath(names, env) {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/** The PowerShell to run: pwsh when asked or found, Windows PowerShell 5.1 on Windows otherwise. */
export function resolveShell(choice, env = process.env, platform = process.platform) {
  const pwshNames = platform === 'win32' ? ['pwsh.exe'] : ['pwsh'];
  if (choice === 'pwsh' || choice === 'auto') {
    const pwsh = onPath(pwshNames, env);
    if (pwsh !== null || choice === 'pwsh') {
      return pwsh;
    }
  }
  if (platform !== 'win32') {
    return null;
  }
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
  const windowsPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(windowsPowerShell) ? windowsPowerShell : onPath(['powershell.exe'], env);
}

/** The environment the bootstrap reads: the caller's, the script's --env values, and the call as JSON. */
export function bootstrapEnv(plan, baseEnv = process.env, cwd = process.cwd()) {
  const params = { ...plan.params };
  for (const [name, file] of Object.entries(plan.paramFiles)) {
    params[name] = readFileSync(path.resolve(cwd, file), 'utf8').replace(/^\uFEFF/, '');
  }
  const env = { ...baseEnv, ...plan.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('VIBE_PS_')) {
      delete env[key];
    }
  }
  if (plan.file !== null) {
    env.VIBE_PS_FILE = path.resolve(cwd, plan.file);
  } else {
    env.VIBE_PS_CODE = plan.code;
  }
  env.VIBE_PS_ARGS = JSON.stringify(plan.args);
  env.VIBE_PS_PARAMS = JSON.stringify(params);
  if (plan.check) {
    env.VIBE_PS_CHECK = '1';
  }
  if (plan.allowTypographic) {
    env.VIBE_PS_ALLOW_TYPOGRAPHIC = '1';
  }
  return env;
}

export function shellArgs() {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BOOTSTRAP_PATH];
}

function main(argv) {
  let plan;
  try {
    plan = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`vibe-ps: ${error.message}\n\n${usage()}`);
      return Promise.resolve(USAGE_EXIT);
    }
    throw error;
  }
  if (plan.help) {
    process.stdout.write(usage());
    return Promise.resolve(0);
  }
  const cwd = path.resolve(plan.cwd ?? process.cwd());
  if (plan.file !== null && !existsSync(path.resolve(cwd, plan.file))) {
    process.stderr.write(`vibe-ps: no such script: ${plan.file}\n`);
    return Promise.resolve(USAGE_EXIT);
  }
  const shell = resolveShell(plan.shell);
  if (shell === null) {
    process.stderr.write(`vibe-ps: no PowerShell found (${plan.shell === 'pwsh' ? 'pwsh is not on PATH' : 'install PowerShell 7 or run on Windows'})\n`);
    return Promise.resolve(NOT_FOUND_EXIT);
  }
  let env;
  try {
    env = bootstrapEnv(plan, process.env, cwd);
  } catch (error) {
    process.stderr.write(`vibe-ps: ${error instanceof Error ? error.message : String(error)}\n`);
    return Promise.resolve(USAGE_EXIT);
  }
  return new Promise((resolve) => {
    const child = spawn(shell, shellArgs(), { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', (error) => {
      process.stderr.write(`vibe-ps: could not start ${shell}: ${error.message}\n`);
      resolve(NOT_FOUND_EXIT);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
