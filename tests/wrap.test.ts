import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bulkhead } from "../src/policies/bulkhead.ts";
import { circuitBreaker } from "../src/policies/circuit-breaker.ts";
import { retry } from "../src/policies/retry.ts";
import { TimeoutError, timeout } from "../src/policies/timeout.ts";
import type { Policy } from "../src/types.ts";
import { wrap } from "../src/wrap.ts";

function mockResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("wrap", () => {
  it("wraps a function with a single policy", async () => {
    const mockFetch = (_url: string) => Promise.resolve(mockResponse(200));
    const resilientFetch = wrap(mockFetch, [
      retry({ attempts: 2, delayMs: 1 }),
    ]);

    const result = await resilientFetch("https://example.com");
    assert.equal(result.status, 200);
  });

  it("composes timeout + retry correctly", async () => {
    let callCount = 0;
    const mockFetch = (_url: string) => {
      callCount += 1;
      if (callCount < 3) {
        return Promise.resolve(mockResponse(500));
      }
      return Promise.resolve(mockResponse(200));
    };

    // timeout wraps retry wraps fetch
    const resilientFetch = wrap(mockFetch, [
      timeout({ ms: 5000 }),
      retry({ attempts: 3, delayMs: 1 }),
    ]);

    const result = await resilientFetch("https://example.com");
    assert.equal(result.status, 200);
    assert.equal(callCount, 3);
  });

  it("timeout fires even with retries happening", async () => {
    const mockFetch = async () => {
      await delay(100);
      return mockResponse(500);
    };

    const resilientFetch = wrap(mockFetch, [
      timeout({ ms: 50 }),
      retry({ attempts: 10, delayMs: 10 }),
    ]);

    await assert.rejects(
      async () => {
        await resilientFetch();
      },
      (err: unknown) => {
        assert.ok(err instanceof TimeoutError);
        return true;
      }
    );
  });

  it("applies policies in correct order (outer to inner)", async () => {
    const order: string[] = [];

    const policyA: Policy = {
      async execute(fn) {
        order.push("A-before");
        const result = await fn();
        order.push("A-after");
        return result;
      },
    };

    const policyB: Policy = {
      async execute(fn) {
        order.push("B-before");
        const result = await fn();
        order.push("B-after");
        return result;
      },
    };

    const mockFetch = () => {
      order.push("fetch");
      return Promise.resolve(mockResponse(200));
    };

    const wrapped = wrap(mockFetch, [policyA, policyB]);
    await wrapped();

    assert.deepEqual(order, [
      "A-before",
      "B-before",
      "fetch",
      "B-after",
      "A-after",
    ]);
  });

  it("passes arguments through to the wrapped function", async () => {
    const mockFetch = (url: string, init?: { method: string }) => {
      assert.equal(url, "https://api.example.com");
      assert.equal(init?.method, "POST");
      return Promise.resolve(mockResponse(201));
    };

    const resilientFetch = wrap(mockFetch, [
      retry({ attempts: 1, delayMs: 1 }),
    ]);
    const result = await resilientFetch("https://api.example.com", {
      method: "POST",
    });
    assert.equal(result.status, 201);
  });

  it("composes all four policies together", async () => {
    let callCount = 0;
    const mockFetch = () => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(mockResponse(500));
      }
      return Promise.resolve(mockResponse(200));
    };

    const resilientFetch = wrap(mockFetch, [
      timeout({ ms: 5000 }),
      circuitBreaker({ halfOpenAfter: 1000, threshold: 5 }),
      bulkhead({ maxConcurrent: 10 }),
      retry({ attempts: 2, delayMs: 1 }),
    ]);

    const result = await resilientFetch();
    assert.equal(result.status, 200);
    assert.equal(callCount, 2);
  });
});
