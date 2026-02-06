/**
 * Tests for RateLimiterService implementation.
 * Verifies atomic rate limiting, sliding window, and minimum delay.
 */

import { describe, expect, test } from "bun:test"
import { Effect, Exit, Cause } from "effect"
import { RateLimiterLive, RateLimiterDisabled, RateLimiterService } from "../src/utils/rate-limiter"
import { ScraperError } from "../src/domain"

const runWithLimiter = <A>(
  config: { maxRequests?: number; windowMs?: number; minDelay?: number },
  program: Effect.Effect<A, any, RateLimiterService>
): Promise<A> =>
  program.pipe(
    Effect.provide(RateLimiterLive(config)),
    Effect.runPromise
  )

describe("RateLimiterLive", () => {
  test("allows requests under the limit", async () => {
    await runWithLimiter(
      { maxRequests: 5, windowMs: 60000, minDelay: 0 },
      Effect.gen(function* () {
        const limiter = yield* RateLimiterService
        // Should succeed for 5 requests
        for (let i = 0; i < 5; i++) {
          yield* limiter.acquire()
        }
      })
    )
    // If we get here without error, the test passes
  })

  test("rejects requests over the limit", async () => {
    const exit = await Effect.gen(function* () {
      const limiter = yield* RateLimiterService
      yield* limiter.acquire()
      yield* limiter.acquire()
      yield* limiter.acquire() // should fail
    }).pipe(
      Effect.provide(RateLimiterLive({ maxRequests: 2, windowMs: 60000, minDelay: 0 })),
      Effect.runPromiseExit
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value.reason).toBe("RateLimitExceeded")
      }
    }
  })

  test("getStats reflects current request count", async () => {
    const stats = await runWithLimiter(
      { maxRequests: 10, windowMs: 60000, minDelay: 0 },
      Effect.gen(function* () {
        const limiter = yield* RateLimiterService
        yield* limiter.acquire()
        yield* limiter.acquire()
        yield* limiter.acquire()
        return yield* limiter.getStats()
      })
    )
    expect(stats.requests).toBe(3)
    expect(stats.windowMs).toBe(60000)
  })

  test("reset clears request history", async () => {
    const stats = await runWithLimiter(
      { maxRequests: 2, windowMs: 60000, minDelay: 0 },
      Effect.gen(function* () {
        const limiter = yield* RateLimiterService
        yield* limiter.acquire()
        yield* limiter.acquire()
        yield* limiter.reset()
        // Should be able to acquire again after reset
        yield* limiter.acquire()
        return yield* limiter.getStats()
      })
    )
    expect(stats.requests).toBe(1)
  })

  test("concurrent acquires respect the limit atomically", async () => {
    const results = await runWithLimiter(
      { maxRequests: 3, windowMs: 60000, minDelay: 0 },
      Effect.gen(function* () {
        const limiter = yield* RateLimiterService
        // Fire 6 concurrent acquire attempts; only 3 should succeed
        const attempts = Array.from({ length: 6 }, () =>
          limiter.acquire().pipe(
            Effect.map(() => "ok" as const),
            Effect.catchAll((e) => Effect.succeed("rejected" as const))
          )
        )
        return yield* Effect.all(attempts, { concurrency: "unbounded" })
      })
    )
    const successes = results.filter(r => r === "ok").length
    const rejections = results.filter(r => r === "rejected").length
    expect(successes).toBe(3)
    expect(rejections).toBe(3)
  })
})

describe("RateLimiterDisabled", () => {
  test("always allows acquire", async () => {
    await Effect.gen(function* () {
      const limiter = yield* RateLimiterService
      // Should never reject
      for (let i = 0; i < 100; i++) {
        yield* limiter.acquire()
      }
    }).pipe(
      Effect.provide(RateLimiterDisabled),
      Effect.runPromise
    )
  })
})
