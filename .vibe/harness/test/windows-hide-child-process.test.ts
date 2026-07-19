import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const WRAPPED = Symbol.for('vibe.selfTest.windowsHideWrapped');
const methods = [
  'spawn',
  'spawnSync',
  'exec',
  'execFile',
  'execSync',
  'execFileSync',
  'fork',
] as const;

describe('self-test Windows child-process isolation', () => {
  it('preloads hidden-window wrappers for every child-process API used by the suite', () => {
    for (const method of methods) {
      const candidate = childProcess[method] as typeof childProcess[typeof method] & {
        [WRAPPED]?: boolean;
      };
      assert.equal(candidate[WRAPPED], true, `${method} was not wrapped by the self-test preload`);
    }
  });

  it('propagates the preload to descendant Node processes', async () => {
    const execFile = promisify(childProcess.execFile);
    const probe = [
      "const childProcess = require('node:child_process');",
      "const wrapped = Symbol.for('vibe.selfTest.windowsHideWrapped');",
      "process.stdout.write(String(childProcess.spawn[wrapped] === true));",
    ].join('');
    const { stdout, stderr } = await execFile(process.execPath, ['--eval', probe], {
      encoding: 'utf8',
    });

    assert.equal(stderr, '');
    assert.equal(stdout, 'true');
    assert.match(process.env.NODE_OPTIONS ?? '', /windows-hide-child-process\.cjs/);
  });
});
