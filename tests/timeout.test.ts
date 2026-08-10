import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TimeoutError, timeout } from "../src/policies/timeout.ts";

function mockResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("TimeoutPolicy", () => {
  it("returns result if completed within timeout", async () => {
    const policy = timeout({ ms: 500 });
    const result = await policy.execute(() =>
      Promise.resolve(mockResponse(200))
    );
    assert.equal(result.status, 200);
  });

  it("throws TimeoutError if operation exceeds timeout", async () => {
    const policy = timeout({ ms: 50 });
    await assert.rejects(
      async () => {
        await policy.execute(async () => {
          await delay(200);
          return mockResponse(200);
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof TimeoutError);
        assert.ok((err as Error).message.includes("50"));
        return true;
      }
    );
  });

  it("propagates errors from the inner function", async () => {
    const policy = timeout({ ms: 500 });
    await assert.rejects(
      async () => {
        await policy.execute(() => Promise.reject(new Error("inner failure")));
      },
      { message: "inner failure" }
    );
  });

  it("handles immediate resolution", async () => {
    const policy = timeout({ ms: 1 });
    const result = await policy.execute(() =>
      Promise.resolve(mockResponse(204))
    );
    assert.equal(result.status, 204);
  });
});
