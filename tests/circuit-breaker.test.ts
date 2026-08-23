import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CircuitState } from "../src/policies/circuit-breaker.ts";
import {
  CircuitOpenError,
  circuitBreaker,
} from "../src/policies/circuit-breaker.ts";

function mockResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function repeat(count: number, operation: () => Promise<void>) {
  if (count <= 0) {
    return;
  }
  await operation();
  await repeat(count - 1, operation);
}

describe("CircuitBreakerPolicy", () => {
  it("allows calls through when closed", async () => {
    const policy = circuitBreaker({ halfOpenAfter: 1000, threshold: 3 });
    const result = await policy.execute(() =>
      Promise.resolve(mockResponse(200))
    );
    assert.equal(result.status, 200);
  });

  it("opens after threshold consecutive failures", async () => {
    const states: CircuitState[] = [];
    const policy = circuitBreaker({
      halfOpenAfter: 1000,
      onStateChange: (s) => states.push(s),
      threshold: 3,
    });

    // 3 failures to trip the breaker
    await repeat(3, () =>
      assert.rejects(() =>
        policy.execute(() => Promise.reject(new Error("fail")))
      )
    );

    assert.deepEqual(states, ["open"]);

    // Next call should be rejected immediately
    await assert.rejects(
      async () => {
        await policy.execute(() => Promise.resolve(mockResponse(200)));
      },
      (err: unknown) => {
        assert.ok(err instanceof CircuitOpenError);
        return true;
      }
    );
  });

  it("resets failure count on success", async () => {
    const states: CircuitState[] = [];
    const policy = circuitBreaker({
      halfOpenAfter: 1000,
      onStateChange: (s) => states.push(s),
      threshold: 3,
    });

    // 2 failures
    await repeat(2, () =>
      assert.rejects(() =>
        policy.execute(() => Promise.reject(new Error("fail")))
      )
    );

    // 1 success resets counter
    await policy.execute(() => Promise.resolve(mockResponse(200)));

    // 2 more failures should not trip it
    await repeat(2, () =>
      assert.rejects(() =>
        policy.execute(() => Promise.reject(new Error("fail")))
      )
    );

    assert.deepEqual(states, []);
  });

  it("transitions to half-open after halfOpenAfter ms", async () => {
    const states: CircuitState[] = [];
    const policy = circuitBreaker({
      halfOpenAfter: 50,
      onStateChange: (s) => states.push(s),
      threshold: 2,
    });

    // Trip the breaker
    await repeat(2, () =>
      assert.rejects(() =>
        policy.execute(() => Promise.reject(new Error("fail")))
      )
    );
    assert.deepEqual(states, ["open"]);

    // Wait for half-open
    await delay(70);

    // Next call should go through (half-open allows one probe)
    const result = await policy.execute(() =>
      Promise.resolve(mockResponse(200))
    );
    assert.equal(result.status, 200);
    assert.deepEqual(states, ["open", "half-open", "closed"]);
  });

  it("allows only one recovery probe while half-open", async () => {
    const policy = circuitBreaker({ halfOpenAfter: 0, threshold: 1 });

    await assert.rejects(
      policy.execute(() => Promise.reject(new Error("failure")))
    );

    let resolveProbe!: (response: Response) => void;
    const firstProbe = policy.execute(
      async () =>
        new Promise<Response>((resolve) => {
          resolveProbe = resolve;
        })
    );

    await assert.rejects(
      policy.execute(async () => mockResponse(200)),
      (error: unknown) => error instanceof CircuitOpenError
    );

    resolveProbe(mockResponse(200));
    await firstProbe;
  });

  it("keeps the recovery probe locked when an older call fails", async () => {
    const policy = circuitBreaker({ halfOpenAfter: 0, threshold: 1 });

    let rejectOlderCall!: (error: Error) => void;
    const olderCall = policy.execute(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectOlderCall = reject;
        })
    );

    await assert.rejects(
      policy.execute(() => Promise.reject(new Error("failure")))
    );

    let resolveProbe!: (response: Response) => void;
    const probe = policy.execute(
      () =>
        new Promise<Response>((resolve) => {
          resolveProbe = resolve;
        })
    );

    rejectOlderCall(new Error("older failure"));
    await assert.rejects(olderCall);
    await assert.rejects(
      policy.execute(() => Promise.resolve(mockResponse(200))),
      (error: unknown) => error instanceof CircuitOpenError
    );

    resolveProbe(mockResponse(200));
    await probe;
  });

  it("recovers when the half-open state callback throws", async () => {
    let throwOnHalfOpen = true;
    const policy = circuitBreaker({
      halfOpenAfter: 0,
      onStateChange: (state) => {
        if (state === "half-open" && throwOnHalfOpen) {
          throwOnHalfOpen = false;
          throw new Error("callback failure");
        }
      },
      threshold: 1,
    });

    await assert.rejects(
      policy.execute(() => Promise.reject(new Error("failure")))
    );
    await assert.rejects(
      policy.execute(() => Promise.resolve(mockResponse(200))),
      { message: "callback failure" }
    );

    const response = await policy.execute(() =>
      Promise.resolve(mockResponse(200))
    );
    assert.equal(response.status, 200);
  });

  it("stays closed when the closed state callback throws", async () => {
    const policy = circuitBreaker({
      halfOpenAfter: 0,
      onStateChange: (state) => {
        if (state === "closed") {
          throw new Error("callback failure");
        }
      },
      threshold: 3,
    });

    await repeat(3, () =>
      assert.rejects(() =>
        policy.execute(() => Promise.reject(new Error("failure")))
      )
    );
    await assert.rejects(
      policy.execute(() => Promise.resolve(mockResponse(200))),
      { message: "callback failure" }
    );

    const response = await policy.execute(() =>
      Promise.resolve(mockResponse(200))
    );
    assert.equal(response.status, 200);
  });

  it("reopens if half-open probe fails", async () => {
    const states: CircuitState[] = [];
    const policy = circuitBreaker({
      halfOpenAfter: 50,
      onStateChange: (s) => states.push(s),
      threshold: 2,
    });

    // Trip the breaker
    await repeat(2, () =>
      assert.rejects(() =>
        policy.execute(() => Promise.reject(new Error("fail")))
      )
    );

    await delay(70);

    // Half-open probe fails
    await assert.rejects(async () => {
      await policy.execute(() => Promise.reject(new Error("still failing")));
    });

    assert.deepEqual(states, ["open", "half-open", "open"]);
  });
});
