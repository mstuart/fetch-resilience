import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { circuitBreaker, CircuitOpenError } from '../src/policies/circuit-breaker.ts';
import type { CircuitState } from '../src/policies/circuit-breaker.ts';

function mockResponse(status: number): Response {
  return { status, ok: status >= 200 && status < 300 } as Response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CircuitBreakerPolicy', () => {
  it('allows calls through when closed', async () => {
    const policy = circuitBreaker({ threshold: 3, halfOpenAfter: 1000 });
    const result = await policy.execute(async () => mockResponse(200));
    assert.equal(result.status, 200);
  });

  it('opens after threshold consecutive failures', async () => {
    const states: CircuitState[] = [];
    const policy = circuitBreaker({
      threshold: 3,
      halfOpenAfter: 1000,
      onStateChange: (s) => states.push(s),
    });

    // 3 failures to trip the breaker
    for (let i = 0; i < 3; i++) {
      await assert.rejects(async () => {
        await policy.execute(async () => {
          throw new Error('fail');
        });
      });
    }

    assert.deepEqual(states, ['open']);

    // Next call should be rejected immediately
    await assert.rejects(
      async () => {
        await policy.execute(async () => mockResponse(200));
      },
      (err: unknown) => {
        assert.ok(err instanceof CircuitOpenError);
        return true;
      },
    );
  });

  it('resets failure count on success', async () => {
    const states: CircuitState[] = [];
    const policy = circuitBreaker({
      threshold: 3,
      halfOpenAfter: 1000,
      onStateChange: (s) => states.push(s),
    });

    // 2 failures
    for (let i = 0; i < 2; i++) {
      await assert.rejects(async () => {
        await policy.execute(async () => {
          throw new Error('fail');
        });
      });
    }

    // 1 success resets counter
    await policy.execute(async () => mockResponse(200));

    // 2 more failures should not trip it
    for (let i = 0; i < 2; i++) {
      await assert.rejects(async () => {
        await policy.execute(async () => {
          throw new Error('fail');
        });
      });
    }

    assert.deepEqual(states, []);
  });

  it('transitions to half-open after halfOpenAfter ms', async () => {
    const states: CircuitState[] = [];
    const policy = circuitBreaker({
      threshold: 2,
      halfOpenAfter: 50,
      onStateChange: (s) => states.push(s),
    });

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      await assert.rejects(async () => {
        await policy.execute(async () => {
          throw new Error('fail');
        });
      });
    }
    assert.deepEqual(states, ['open']);

    // Wait for half-open
    await delay(70);

    // Next call should go through (half-open allows one probe)
    const result = await policy.execute(async () => mockResponse(200));
    assert.equal(result.status, 200);
    assert.deepEqual(states, ['open', 'half-open', 'closed']);
  });

  it('reopens if half-open probe fails', async () => {
    const states: CircuitState[] = [];
    const policy = circuitBreaker({
      threshold: 2,
      halfOpenAfter: 50,
      onStateChange: (s) => states.push(s),
    });

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      await assert.rejects(async () => {
        await policy.execute(async () => {
          throw new Error('fail');
        });
      });
    }

    await delay(70);

    // Half-open probe fails
    await assert.rejects(async () => {
      await policy.execute(async () => {
        throw new Error('still failing');
      });
    });

    assert.deepEqual(states, ['open', 'half-open', 'open']);
  });
});
