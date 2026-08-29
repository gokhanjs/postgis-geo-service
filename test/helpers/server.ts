import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { adminPoolConfig, testDbEnv } from './env.js';

export interface TestServer {
  baseUrl: string;
  pool: Pool;
  stop: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') {
        srv.close();
        reject(new Error('Could not determine a free port'));
        return;
      }
      const { port } = address;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error(`Server did not become healthy at ${baseUrl}`);
}

/**
 * Boots the service as a real child process on a free port and waits until it
 * answers /health. Driving it over HTTP rather than importing it keeps these
 * tests indifferent to how the source is organised, which is the whole point:
 * they must survive the refactor unchanged.
 */
export async function startTestServer(extraEnv: Record<string, string> = {}): Promise<TestServer> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn('node', ['src/server.ts'], {
    env: { ...process.env, ...testDbEnv, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs: string[] = [];
  child.stdout?.on('data', (c: Buffer) => logs.push(c.toString()));
  child.stderr?.on('data', (c: Buffer) => logs.push(c.toString()));

  try {
    await waitForHealth(baseUrl, child);
  } catch (err) {
    child.kill('SIGKILL');
    throw new Error(`${(err as Error).message}\n--- server output ---\n${logs.join('')}`, {
      cause: err,
    });
  }

  const pool = new Pool(adminPoolConfig);

  return {
    baseUrl,
    pool,
    stop: async () => {
      await pool.end();
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 5000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
  };
}
