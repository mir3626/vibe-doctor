import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  computePayloadSha256,
  type ReviewRequest,
} from '../src/pro-bridge/contract.js';
import {
  ManualDirectoryTransport,
  ManualTransportUnsupportedError,
  copyFileToClipboard,
  readClipboardText,
  type HostExecPorts,
} from '../src/pro-bridge/transports/manual.js';

const NOW = new Date('2026-07-15T09:00:00.000Z');

function request(requestId = 'AUD-20260715-unit01'): ReviewRequest {
  const draft: ReviewRequest = {
    schemaVersion: 'vibe-pro-review-request-v1',
    requestId,
    kind: 'goal_audit',
    origin: 'cli',
    repository: {
      fullName: 'owner/repo',
      remoteUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
    },
    git: {
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      branch: 'feature/manual-transport',
      headVisibleOnGitHub: true,
      compareUrlHint: `https://github.com/owner/repo/compare/${'a'.repeat(40)}...${'b'.repeat(40)}`,
      patchAttachmentSha256: null,
    },
    goalSource: null,
    userGoal: 'Audit the manual transport.',
    reviewPrompt: '# Manual transport audit',
    outputContract: {
      requiredFiles: [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ],
    },
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

interface ExecCall {
  command: string;
  args: string[];
  input: string | null;
}

interface ExecPlan {
  ok: boolean;
  stdout?: string;
  stderr?: string;
}

function fakeExecFile(plans: ExecPlan[], calls: ExecCall[]): NonNullable<HostExecPorts['execFile']> {
  const implementation = (
    command: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): ChildProcess => {
    const plan = plans[calls.length] ?? { ok: false, stderr: 'missing fake exec plan' };
    const call: ExecCall = { command, args: [...args], input: null };
    calls.push(call);
    queueMicrotask(() => {
      callback(
        plan.ok ? null : new Error(plan.stderr ?? 'fake exec failure'),
        plan.stdout ?? '',
        plan.stderr ?? '',
      );
    });
    return {
      stdin: {
        end(value?: string | Uint8Array) {
          call.input = value === undefined ? '' : String(value);
        },
      },
    } as unknown as ChildProcess;
  };
  return implementation as unknown as NonNullable<HostExecPorts['execFile']>;
}

describe('manual directory transport', () => {
  it('rejects duplicate request creation', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-transport-duplicate-'));
    try {
      const transport = new ManualDirectoryTransport({ repoRoot, now: () => NOW });
      const input = request();
      await transport.createRequest(input);
      await assert.rejects(
        transport.createRequest(input),
        /Pro Bridge request already exists/,
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects result file fetch as unsupported', async () => {
    const transport = new ManualDirectoryTransport({ repoRoot: tmpdir(), now: () => NOW });
    await assert.rejects(
      transport.getResultFile('AUD-20260715-unit01', 'README.md'),
      (error: unknown) =>
        error instanceof ManualTransportUnsupportedError
        && error.name === 'ManualTransportUnsupportedError'
        && /clipboard or file vibe-bundle/.test(error.message),
    );
  });

  it('acknowledges import with a receipt marker', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-transport-ack-'));
    try {
      const transport = new ManualDirectoryTransport({ repoRoot, now: () => NOW });
      const input = request();
      const handle = await transport.createRequest(input);
      const receipt = {
        requestId: input.requestId,
        folder: '2026-07-15-transport-unit-pro-review',
        installedPath: path.join(repoRoot, 'installed', '2026-07-15-transport-unit-pro-review'),
        resultFilesSha256: 'c'.repeat(64),
        importedAt: NOW.toISOString(),
      };

      await transport.acknowledgeImport(input.requestId, receipt);

      assert.deepEqual(
        JSON.parse(await readFile(path.join(handle.requestDir, 'imported.json'), 'utf8')),
        receipt,
      );
      assert.equal((await transport.getRequestStatus(input.requestId)).state, 'imported');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('copies prompt file through the injected clipboard adapter', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-clipboard-copy-'));
    try {
      const promptPath = path.join(repoRoot, 'prompt.md');
      const prompt = '# Fake clipboard prompt\n';
      await writeFile(promptPath, prompt, 'utf8');

      const windowsCalls: ExecCall[] = [];
      const windows = await copyFileToClipboard(promptPath, {
        platform: 'win32',
        execFile: fakeExecFile([{ ok: true }], windowsCalls),
      });
      assert.deepEqual(windows, { ok: true, method: 'powershell', error: null });
      assert.equal(windowsCalls[0]?.command, 'powershell.exe');
      const windowsCommand = windowsCalls[0]?.args.at(-1) ?? '';
      assert.equal(windowsCommand.includes(promptPath), true);
      assert.doesNotMatch(windowsCommand, /\$args/);
      assert.equal(windowsCalls[0]?.input, null);

      const quotedPath = String.raw`C:\bridge\reviewer's prompt.md`;
      const quotedCalls: ExecCall[] = [];
      await copyFileToClipboard(quotedPath, {
        platform: 'win32',
        execFile: fakeExecFile([{ ok: true }], quotedCalls),
      });
      const quotedCommand = quotedCalls[0]?.args.at(-1) ?? '';
      assert.equal(quotedCommand.includes(String.raw`C:\bridge\reviewer''s prompt.md`), true);
      assert.doesNotMatch(quotedCommand, /\$args/);

      const macCalls: ExecCall[] = [];
      const mac = await copyFileToClipboard(promptPath, {
        platform: 'darwin',
        execFile: fakeExecFile([{ ok: true }], macCalls),
      });
      assert.deepEqual(mac, { ok: true, method: 'pbcopy', error: null });
      assert.equal(macCalls[0]?.command, 'pbcopy');
      assert.equal(macCalls[0]?.input, prompt);

      const linuxCalls: ExecCall[] = [];
      const linux = await copyFileToClipboard(promptPath, {
        platform: 'linux',
        execFile: fakeExecFile(
          [{ ok: false, stderr: 'xclip unavailable' }, { ok: true }],
          linuxCalls,
        ),
      });
      assert.deepEqual(linux, { ok: true, method: 'wl-copy', error: null });
      assert.deepEqual(linuxCalls.map((call) => call.command), ['xclip', 'wl-copy']);
      assert.deepEqual(linuxCalls.map((call) => call.input), [prompt, prompt]);

      const failedCalls: ExecCall[] = [];
      const failed = await copyFileToClipboard(promptPath, {
        platform: 'linux',
        execFile: fakeExecFile(
          [{ ok: false, stderr: 'xclip unavailable' }, { ok: false, stderr: 'wl-copy unavailable' }],
          failedCalls,
        ),
      });
      assert.equal(failed.ok, false);
      assert.equal(failed.method, null);
      assert.match(failed.error ?? '', /wl-copy unavailable/);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('branches clipboard reads by platform without spawning real processes', async () => {
    const windowsCalls: ExecCall[] = [];
    const windows = await readClipboardText({
      platform: 'win32',
      execFile: fakeExecFile([{ ok: true, stdout: 'windows text' }], windowsCalls),
    });
    assert.deepEqual(windows, { ok: true, text: 'windows text', error: null });
    assert.equal(windowsCalls[0]?.command, 'powershell.exe');

    const macCalls: ExecCall[] = [];
    const mac = await readClipboardText({
      platform: 'darwin',
      execFile: fakeExecFile([{ ok: true, stdout: 'mac text' }], macCalls),
    });
    assert.deepEqual(mac, { ok: true, text: 'mac text', error: null });
    assert.equal(macCalls[0]?.command, 'pbpaste');

    const linuxCalls: ExecCall[] = [];
    const linux = await readClipboardText({
      platform: 'linux',
      execFile: fakeExecFile(
        [{ ok: false, stderr: 'xclip unavailable' }, { ok: true, stdout: 'wayland text' }],
        linuxCalls,
      ),
    });
    assert.deepEqual(linux, { ok: true, text: 'wayland text', error: null });
    assert.deepEqual(linuxCalls.map((call) => call.command), ['xclip', 'wl-paste']);
  });
});
