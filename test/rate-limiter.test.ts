/**
 * The sliding-window rate limiter through its interface: window rejection
 * and atomicity under concurrent acquires.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { RateLimiterLive, RateLimiterService } from "../src/utils/rate-limiter"

const runWithLimiter = <A>(
  config: Parameters<typeof RateLimiterLive>[0],
  body: (acquire: () => Effect.Effect<void, unknown>) => Effect.Effect<A>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const limiter = yield* RateLimiterService
      return yield* body(limiter.acquire)
    }).pipe(Effect.provide(RateLimiterLive(config)))
  )

describe("RateLimiterLive", () => {
  test("rejects the request that exceeds the window", async () => {
    const exits = await runWithLimiter(
      { maxRequests: 2, windowMs: 60_000, minDelay: 0 },
      (acquire) =>
        Effect.gen(function* () {
          const first = yield* acquire().pipe(Effect.exit)
          const second = yield* acquire().pipe(Effect.exit)
          const third = yield* acquire().pipe(Effect.exit)
          return [first, second, third]
        })
    )

    expect(exits.map(Exit.isSuccess)).toEqual([true, true, false])
  })

  test("concurrent acquires cannot both take the last slot", async () => {
    const exits = await runWithLimiter(
      { maxRequests: 1, windowMs: 60_000, minDelay: 0 },
      (acquire) =>
        Effect.all(
          [acquire().pipe(Effect.exit), acquire().pipe(Effect.exit), acquire().pipe(Effect.exit)],
          { concurrency: "unbounded" }
        )
    )

    expect(exits.filter(Exit.isSuccess).length).toBe(1)
  })

  test("failure carries the typed RateLimitExceeded reason", async () => {
    const exit = await runWithLimiter(
      { maxRequests: 0, windowMs: 60_000, minDelay: 0 },
      (acquire) => acquire().pipe(Effect.exit)
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("RateLimitExceeded")
    }
  })
})
