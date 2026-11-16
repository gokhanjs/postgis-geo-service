import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { queryOsrmTable } from '../../src/lib/osrm-client.ts';

/**
 * Transport behaviour only: during a blue/green switch the old routing
 * container closes connections the client still holds open.
 */

const OK_BODY = JSON.stringify({ code: 'Ok', distances: [[0, 1200]], durations: [[0, 90]] });
const point = { lng: 28.75, lat: 41.27 };

let server: Server | undefined;

async function stub(handle: (attempt: number) => 'drop' | 'hang' | number): Promise<{
  url: string;
  attempts: () => number;
}> {
  let attempts = 0;
  server = createServer((req, res) => {
    attempts += 1;
    const outcome = handle(attempts);
    if (outcome === 'drop') {
      req.socket.destroy();
      return;
    }
    if (outcome === 'hang') return;
    res.writeHead(outcome, { 'content-type': 'application/json' });
    res.end(outcome === 200 ? OK_BODY : '{}');
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, attempts: () => attempts };
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

describe('queryOsrmTable', () => {
  it('retries once when the connection drops before a response', async () => {
    const osrm = await stub((attempt) => (attempt === 1 ? 'drop' : 200));

    const table = await queryOsrmTable(osrm.url, point, [point]);

    expect(table?.distances).toEqual([[0, 1200]]);
    expect(osrm.attempts()).toBe(2);
  });

  it('does not retry an HTTP error response', async () => {
    const osrm = await stub(() => 503);

    const table = await queryOsrmTable(osrm.url, point, [point]);

    expect(table).toBeNull();
    expect(osrm.attempts()).toBe(1);
  });

  it('does not retry a request that timed out', async () => {
    const osrm = await stub(() => 'hang');

    const table = await queryOsrmTable(osrm.url, point, [point]);

    expect(table).toBeNull();
    expect(osrm.attempts()).toBe(1);
  });

  it('gives up after the single retry', async () => {
    const osrm = await stub(() => 'drop');

    const table = await queryOsrmTable(osrm.url, point, [point]);

    expect(table).toBeNull();
    expect(osrm.attempts()).toBe(2);
  });
});
