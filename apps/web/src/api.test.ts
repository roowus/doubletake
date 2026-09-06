import { describe, expect, it } from 'vitest';
import { ApiError, fetchWithRetry, OFFLINE_MESSAGE } from './api';

const networkDown = () => Promise.reject(new TypeError('Failed to fetch'));

describe('fetchWithRetry', () => {
  it('retries a GET while the network is down and returns the first response', async () => {
    let calls = 0;
    const impl = (() => {
      calls++;
      return calls < 3 ? networkDown() : Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;
    const res = await fetchWithRetry('/api/status', { method: 'GET' }, impl, [1, 1]);
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('gives up with a readable offline ApiError(0) after the retries', async () => {
    let calls = 0;
    const impl = (() => {
      calls++;
      return networkDown();
    }) as typeof fetch;
    const err = await fetchWithRetry('/api/status', { method: 'GET' }, impl, [1, 1]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toBe(OFFLINE_MESSAGE);
    expect(calls).toBe(3);
  });

  it('never retries a non-GET (an ingest must not be sent twice)', async () => {
    let calls = 0;
    const impl = (() => {
      calls++;
      return networkDown();
    }) as typeof fetch;
    const err = await fetchWithRetry('/api/ingest', { method: 'POST' }, impl, [1, 1]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it('passes HTTP error responses through untouched', async () => {
    const impl = (() => Promise.resolve(new Response('nope', { status: 404 }))) as typeof fetch;
    const res = await fetchWithRetry('/api/x', { method: 'GET' }, impl, [1]);
    expect(res.status).toBe(404);
  });
});
