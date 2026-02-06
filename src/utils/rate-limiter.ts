/**
 * Rate limiting to prevent excessive requests to Google Flights
 */

import { Effect, Layer, Context, Ref, Duration } from "effect"
import { ScraperError } from "../domain"

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Maximum number of requests per window */
  maxRequests?: number
  /** Time window in milliseconds */
  windowMs?: number
  /** Minimum delay between requests in milliseconds */
  minDelay?: number
}

/**
 * Default rate limiter configuration
 * Conservative limits to avoid triggering Google's rate limiting
 */
export const defaultRateLimiterConfig: RateLimiterConfig = {
  maxRequests: 10,          // 10 requests
  windowMs: 60 * 1000,      // per minute
  minDelay: 2000            // 2 seconds between requests
}

/**
 * Request timestamp record
 */
interface RequestRecord {
  timestamp: number
}

/**
 * Rate limiter service definition using idiomatic Effect v3 class-based Tag.
 */
export class RateLimiterService extends Context.Tag("RateLimiterService")<
  RateLimiterService,
  {
    readonly acquire: () => Effect.Effect<void, ScraperError>
    readonly reset: () => Effect.Effect<void>
    readonly getStats: () => Effect.Effect<{ requests: number; windowMs: number }>
  }
>() {}

/**
 * In-memory rate limiter implementation using sliding window
 */
export const RateLimiterLive = (config: RateLimiterConfig = defaultRateLimiterConfig) =>
  Layer.effect(
    RateLimiterService,
    Effect.gen(function* () {
      const { maxRequests = 10, windowMs = 60000, minDelay = 2000 } = config
      
      // Store request timestamps
      const requestsRef = yield* Ref.make<RequestRecord[]>([])
      const lastRequestRef = yield* Ref.make<number>(0)

      return {
        acquire: () =>
          Effect.gen(function* () {
            const now = Date.now()
            const windowStart = now - windowMs

            // Atomically check rate limit AND record the request in one step.
            // This prevents TOCTOU races and lost updates under concurrency.
            const checkResult = yield* Ref.modify(requestsRef, (requests): readonly [{ allowed: boolean; waitTime: number }, RequestRecord[]] => {
              const recent = requests.filter(r => r.timestamp > windowStart)

              if (recent.length >= maxRequests) {
                const oldestRequest = recent[0]
                const waitTime = oldestRequest.timestamp + windowMs - now
                // Return rejection result, leave state unchanged
                return [{ allowed: false, waitTime }, requests] as const
              }

              // Record this request atomically with the check
              const updated = [...recent, { timestamp: now }]
              return [{ allowed: true, waitTime: 0 }, updated] as const
            })

            if (!checkResult.allowed) {
              return yield* Effect.fail(new ScraperError({
                reason: "RateLimitExceeded",
                message: `Rate limit exceeded. Please wait ${Math.ceil(checkResult.waitTime / 1000)} seconds before trying again.`
              }))
            }

            // Enforce minimum delay between requests.
            // getAndSet is atomic: only one fiber sees the old value.
            const lastRequest = yield* Ref.getAndSet(lastRequestRef, now)
            const timeSinceLastRequest = now - lastRequest

            if (timeSinceLastRequest < minDelay && lastRequest > 0) {
              const waitTime = minDelay - timeSinceLastRequest
              yield* Effect.sleep(Duration.millis(waitTime))
            }
          }),

        reset: () =>
          Effect.gen(function* () {
            yield* Ref.set(requestsRef, [])
            yield* Ref.set(lastRequestRef, 0)
          }),

        getStats: () =>
          Effect.gen(function* () {
            const requests = yield* Ref.get(requestsRef)
            const now = Date.now()
            const windowStart = now - windowMs
            const recentRequests = requests.filter(r => r.timestamp > windowStart)

            return {
              requests: recentRequests.length,
              windowMs
            }
          })
      }
    })
  )

/**
 * No-op rate limiter (for disabling rate limiting)
 */
export const RateLimiterDisabled = Layer.succeed(
  RateLimiterService,
  {
    acquire: () => Effect.void,
    reset: () => Effect.void,
    getStats: () => Effect.succeed({ requests: 0, windowMs: 0 })
  }
)

