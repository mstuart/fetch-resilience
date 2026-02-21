import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/policies/retry.ts';

function mockResponse(status: number): Response {
  return { status, ok: status >= 200 && status < 300 } as Response;
}

describe('RetryPolicy', () => {
  it('returns immediately on success', async () => {
    const policy = retry({ attempts: 3 });
    let callCount = 0;
    const result = await policy.execute(async () => {
      callCount++;
      return mockResponse(200);
    });
    assert.equal(result.status, 200);
    assert.equal(callCount, 1);
  });

  it('retries on 500 and returns on eventual success', async () => {
    const policy = retry({ attempts: 3, delayMs: 1 });
    let callCount = 0;
    const result = await policy.execute(async () => {
      callCount++;
      if (callCount < 3) return mockResponse(500);
      return mockResponse(200);
    });
    assert.equal(result.status, 200);
    assert.equal(callCount, 3);
  });

  it('returns last failing response after exhausting attempts', async () => {
    const policy = retry({ attempts: 2, delayMs: 1 });
    let callCount = 0;
    const result = await policy.execute(async () => {
      callCount++;
      return mockResponse(503);
    });
    assert.equal(result.status, 503);
    assert.equal(callCount, 3); // initial + 2 retries
  });

  it('does not retry on non-retryable status codes', async () => {
    const policy = retry({ attempts: 3, delayMs: 1 });
    let callCount = 0;
    const result = await policy.execute(async () => {
      callCount++;
      return mockResponse(400);
    });
    assert.equal(result.status, 400);
    assert.equal(callCount, 1);
  });

  it('retries on network errors when retryOnError is true', async () => {
    const policy = retry({ attempts: 2, delayMs: 1, retryOnError: true });
    let callCount = 0;
    const result = await policy.execute(async () => {
      callCount++;
      if (callCount < 2) throw new Error('Network error');
      return mockResponse(200);
    });
    assert.equal(result.status, 200);
    assert.equal(callCount, 2);
  });

  it('does not retry on network errors when retryOnError is false', async () => {
    const policy = retry({ attempts: 2, delayMs: 1, retryOnError: false });
    let callCount = 0;
    await assert.rejects(async () => {
      await policy.execute(async () => {
        callCount++;
        throw new Error('Network error');
      });
    }, { message: 'Network error' });
    assert.equal(callCount, 1);
  });

  it('uses custom retryOn status codes', async () => {
    const policy = retry({ attempts: 2, delayMs: 1, retryOn: [418] });
    let callCount = 0;
    const result = await policy.execute(async () => {
      callCount++;
      if (callCount < 2) return mockResponse(418);
      return mockResponse(200);
    });
    assert.equal(result.status, 200);
    assert.equal(callCount, 2);
  });

  it('exponential backoff increases delay between retries', async () => {
    const policy = retry({ attempts: 3, backoff: 'exponential', delayMs: 50, jitter: false });
    const timestamps: number[] = [];
    let callCount = 0;
    await policy.execute(async () => {
      callCount++;
      timestamps.push(Date.now());
      if (callCount <= 3) return mockResponse(500);
      return mockResponse(200);
    });
    // timestamps[0] -> initial call
    // timestamps[1] -> after 50*2^1 = 100ms
    // timestamps[2] -> after 50*2^2 = 200ms
    // timestamps[3] -> after 50*2^3 = 400ms
    assert.ok(timestamps.length >= 3, 'Should have at least 3 calls');
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    // Exponential should show increasing delays (with some tolerance)
    assert.ok(gap1 >= 80, `First gap ${gap1}ms should be >= 80ms (target ~100ms)`);
    assert.ok(gap2 >= 160, `Second gap ${gap2}ms should be >= 160ms (target ~200ms)`);
    assert.ok(gap2 > gap1, `Second gap (${gap2}ms) should be larger than first (${gap1}ms)`);
  });

  it('linear backoff increases delay linearly', async () => {
    const policy = retry({ attempts: 3, backoff: 'linear', delayMs: 50, jitter: false });
    const timestamps: number[] = [];
    let callCount = 0;
    await policy.execute(async () => {
      callCount++;
      timestamps.push(Date.now());
      if (callCount <= 2) return mockResponse(500);
      return mockResponse(200);
    });
    // timestamps[1] after delay = 50*1 = 50ms
    // timestamps[2] after delay = 50*2 = 100ms
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    assert.ok(gap1 >= 35, `First gap ${gap1}ms should be ~50ms`);
    assert.ok(gap2 >= 80, `Second gap ${gap2}ms should be ~100ms`);
  });
});
