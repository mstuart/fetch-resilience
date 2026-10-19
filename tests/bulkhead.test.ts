import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BulkheadRejectedError, bulkhead } from "../src/policies/bulkhead.ts";

function mockResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("BulkheadPolicy", () => {
  it("releases a slot when the operation throws synchronously", async () => {
    const policy = bulkhead({ maxConcurrent: 1, maxQueue: 0 });
    const failure = new Error("synchronous failure");
    await assert.rejects(
      async () =>
        policy.execute(() => {
          throw failure;
        }),
      failure
    );
    const response = await policy.execute(() =>
      Promise.resolve(mockResponse(200))
    );
    assert.equal(response.status, 200);
  });

  it("rejects a synchronous queued failure and continues the queue", async () => {
    const policy = bulkhead({ maxConcurrent: 1 });
    let release!: (response: Response) => void;
    const first = policy.execute(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    await Promise.resolve();
    const failure = new Error("queued failure");
    const queued = assert.rejects(
      policy.execute(() => {
        throw failure;
      }),
      failure
    );
    const last = policy.execute(() => Promise.resolve(mockResponse(201)));
    const settled = Promise.all([first, queued, last]);
    release(mockResponse(200));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const results = await Promise.race([
        settled,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("queue stalled")), 1000);
        }),
      ]);
      assert.equal(results[2].status, 201);
    } finally {
      clearTimeout(timer);
    }
  });

  it("rejects a non-positive concurrency limit", () => {
    assert.throws(() => bulkhead({ maxConcurrent: 0 }), {
      message: "maxConcurrent must be a positive integer",
      name: "TypeError",
    });
  });

  it("allows calls up to maxConcurrent", async () => {
    const policy = bulkhead({ maxConcurrent: 2 });
    const results = await Promise.all([
      policy.execute(() => Promise.resolve(mockResponse(200))),
      policy.execute(() => Promise.resolve(mockResponse(201))),
    ]);
    assert.equal(results[0].status, 200);
    assert.equal(results[1].status, 201);
  });

  it("queues calls exceeding maxConcurrent", async () => {
    const policy = bulkhead({ maxConcurrent: 1 });
    const order: number[] = [];

    const p1 = policy.execute(async () => {
      await delay(50);
      order.push(1);
      return mockResponse(200);
    });

    const p2 = policy.execute(() => {
      order.push(2);
      return Promise.resolve(mockResponse(201));
    });

    await Promise.all([p1, p2]);
    // p1 should complete first, then p2 runs
    assert.deepEqual(order, [1, 2]);
  });

  it("rejects when queue is full", async () => {
    const policy = bulkhead({ maxConcurrent: 1, maxQueue: 1 });

    // Start a slow execution
    const p1 = policy.execute(async () => {
      await delay(100);
      return mockResponse(200);
    });

    // This one goes to queue
    const p2 = policy.execute(() => Promise.resolve(mockResponse(201)));

    // This one should be rejected - queue is full
    await assert.rejects(
      async () => {
        await policy.execute(() => Promise.resolve(mockResponse(202)));
      },
      (err: unknown) => {
        assert.ok(err instanceof BulkheadRejectedError);
        return true;
      }
    );

    await Promise.all([p1, p2]);
  });

  it("processes queued items after running ones complete", async () => {
    const policy = bulkhead({ maxConcurrent: 2 });
    const running: number[] = [];
    let maxRunning = 0;

    function trackedExec(id: number): Promise<Response> {
      return policy.execute(async () => {
        running.push(id);
        maxRunning = Math.max(maxRunning, running.length);
        await delay(30);
        running.splice(running.indexOf(id), 1);
        return mockResponse(200);
      });
    }

    await Promise.all([
      trackedExec(1),
      trackedExec(2),
      trackedExec(3),
      trackedExec(4),
    ]);

    assert.equal(maxRunning, 2, "Should never exceed maxConcurrent");
  });

  it("handles errors without breaking the queue", async () => {
    const policy = bulkhead({ maxConcurrent: 1 });

    const p1 = policy
      .execute(() => Promise.reject(new Error("boom")))
      .catch((e) => e);

    const p2 = policy.execute(() => Promise.resolve(mockResponse(200)));

    const [err, result] = await Promise.all([p1, p2]);
    assert.ok(err instanceof Error);
    assert.equal((err as Error).message, "boom");
    assert.equal(result.status, 200);
  });
});
