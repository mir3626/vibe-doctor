import {
  spawn as defaultSpawn,
  type ChildProcess,
} from 'node:child_process';

export type TunnelKind = 'cloudflared' | 'ngrok' | 'none';

export interface TunnelPorts {
  spawn?: typeof defaultSpawn;
  timeoutMs?: number;
}

export interface TunnelHandle {
  kind: TunnelKind;
  publicUrl: string | null;
  reason?: string;
  stop(): Promise<void>;
}

function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    child.once('exit', finish);
    child.once('error', finish);
    child.kill();
    setTimeout(finish, 2_000).unref();
  });
}

function extractUrl(kind: TunnelKind, line: string): string | null {
  if (kind === 'cloudflared') {
    return line.match(/https:\/\/[A-Za-z0-9-]+\.trycloudflare\.com\b/)?.[0] ?? null;
  }
  if (kind === 'ngrok') {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      return typeof value.url === 'string' && value.url.startsWith('https://')
        ? value.url
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function startTunnel(
  kind: TunnelKind,
  port: number,
  ports: TunnelPorts = {},
): Promise<TunnelHandle> {
  if (kind === 'none') {
    return { kind, publicUrl: null, async stop() {} };
  }

  const spawn = ports.spawn ?? defaultSpawn;
  const command = kind === 'cloudflared' ? 'cloudflared' : 'ngrok';
  const args = kind === 'cloudflared'
    ? ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate']
    : ['http', String(port), '--log', 'stdout', '--log-format', 'json'];
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return {
      kind,
      publicUrl: null,
      reason: error instanceof Error ? error.message : String(error),
      async stop() {},
    };
  }

  const discovery = await new Promise<{ publicUrl: string | null; reason: string | null }>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (result: { publicUrl: string | null; reason: string | null }): void => {
      if (!settled) {
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        resolve(result);
      }
    };
    const consume = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) {
        return;
      }
      let buffered = '';
      stream.on('data', (chunk: Buffer | string) => {
        buffered += String(chunk);
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          const publicUrl = extractUrl(kind, line);
          if (publicUrl) {
            finish({ publicUrl, reason: null });
            return;
          }
        }
        const publicUrl = extractUrl(kind, buffered);
        if (publicUrl) {
          finish({ publicUrl, reason: null });
        }
      });
    };
    consume(child.stdout);
    consume(child.stderr);
    child.once('error', (error) => finish({ publicUrl: null, reason: error.message }));
    child.once('exit', (code, signal) => finish({
      publicUrl: null,
      reason: `tunnel exited before publishing a URL (${code ?? signal ?? 'unknown'})`,
    }));
    timer = setTimeout(
      () => finish({ publicUrl: null, reason: 'tunnel URL discovery timed out' }),
      ports.timeoutMs ?? 20_000,
    );
  });

  const base = {
    kind,
    publicUrl: discovery.publicUrl,
    async stop(): Promise<void> {
      await stopChild(child);
    },
  };
  return discovery.reason === null ? base : { ...base, reason: discovery.reason };
}
