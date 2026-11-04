import assert from "node:assert/strict";
import { it } from "node:test";
import { bulkhead } from "../src/policies/bulkhead.ts";
import { circuitBreaker } from "../src/policies/circuit-breaker.ts";
import { retry } from "../src/policies/retry.ts";
import { timeout } from "../src/policies/timeout.ts";

it("rejects timeout durations that platform timers turn into immediate deadlines", () => {
  for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    assert.throws(() => timeout({ ms }));
  }
  assert.doesNotThrow(() => timeout({ ms: 0 }));
  assert.doesNotThrow(() => timeout({ ms: 2_147_483_647 }));
});
it("rejects invalid bulkhead queue capacities while preserving unlimited queues", () => {
  for (const maxQueue of [-1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => bulkhead({ maxConcurrent: 1, maxQueue }));
  }
  for (const maxQueue of [0, 1, Number.POSITIVE_INFINITY]) {
    assert.doesNotThrow(() => bulkhead({ maxConcurrent: 1, maxQueue }));
  }
});
it("rejects circuit configurations that disable tripping or recovery", () => {
  for (const threshold of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => circuitBreaker({ halfOpenAfter: 10, threshold }));
  }
  for (const halfOpenAfter of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => circuitBreaker({ halfOpenAfter, threshold: 1 }));
  }
  assert.doesNotThrow(() => circuitBreaker({ halfOpenAfter: 0, threshold: 1 }));
});
it("keeps retry backoff within the supported timer range", async (t) => {
  const delays: number[] = [];
  t.mock.method(globalThis, "setTimeout", ((
    callback: () => void,
    delay: number
  ) => {
    delays.push(delay);
    queueMicrotask(callback);
    return 0;
  }) as unknown as typeof setTimeout);
  let calls = 0;
  await retry({
    attempts: 2,
    backoff: "exponential",
    delayMs: 1_000_000_000,
  }).execute(() => {
    calls += 1;
    return Promise.resolve(
      new Response(null, { status: calls < 3 ? 503 : 200 })
    );
  });
  assert.deepEqual(delays, [2_000_000_000, 2_147_483_647]);
  for (const delayMs of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2_147_483_648,
  ]) {
    assert.throws(() => retry({ attempts: 1, delayMs }));
  }
});

it("non-HTTP policies return scalar and null results without response assumptions", async () => {
  assert.equal(
    await timeout<number>({ ms: 50 }).execute(() => Promise.resolve(42)),
    42
  );
  assert.equal(
    await timeout<null>({ ms: 50 }).execute(() => Promise.resolve(null)),
    null
  );
  assert.equal(
    await bulkhead<string>({ maxConcurrent: 1 }).execute(() =>
      Promise.resolve("ready")
    ),
    "ready"
  );
  assert.deepEqual(
    await circuitBreaker<number[]>({ halfOpenAfter: 0, threshold: 2 }).execute(
      () => Promise.resolve([1, 2])
    ),
    [1, 2]
  );
});
