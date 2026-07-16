/**
 * Rate limiting to prevent excessive requests to Google Flights
 */

import { Effect, Layer, Context, Ref, Duration, Clock } from "effect"
import { ScraperError, ScraperErrors } from "../domain"

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

interface RateLimiterState {
  /** Effective request times (ms since epoch) inside the sliding window */
  readonly requests: ReadonlyArray<number>
  /** Effective time of the most recent request, 0 if none yet */
  readonly last: number
}

type AcquireDecision =
  | { readonly granted: true; readonly delayMs: number }
  | { readonly granted: false; readonly waitMs: number }

/**
 * Rate limiter service interface
 */
export class RateLimiterService extends Context.Service<RateLimiterService, {
  readonly acquire: () => Effect.Effect<void, ScraperError>
  readonly reset: () => Effect.Effect<void>
  readonly getStats: () => Effect.Effect<{ requests: number; windowMs: number }>
}>()("RateLimiterService") {}

/**
 * In-memory rate limiter implementation using sliding window.
 * The slot reservation happens inside a single Ref.modify so concurrent
 * acquires cannot both pass the window check.
 */
export const RateLimiterLive = (config: RateLimiterConfig = defaultRateLimiterConfig) =>
  Layer.effect(
    RateLimiterService,
    Effect.gen(function* () {
      const { maxRequests = 10, windowMs = 60000, minDelay = 2000 } = config

      const stateRef = yield* Ref.make<RateLimiterState>({ requests: [], last: 0 })

      const acquire = Effect.fn("RateLimiter.acquire")(function* () {
        const now = yield* Clock.currentTimeMillis

        const decision = yield* Ref.modify(stateRef, (state): [AcquireDecision, RateLimiterState] => {
          const windowStart = now - windowMs
          const recent = state.requests.filter((t) => t > windowStart)

          if (recent.length >= maxRequests) {
            return [{ granted: false, waitMs: recent[0] + windowMs - now }, { ...state, requests: recent }]
          }

          // Reserve the slot at its effective time: after the pacing delay,
          // so a concurrent acquire spaces itself off this one.
          const delayMs = state.last > 0 ? Math.max(0, minDelay - (now - state.last)) : 0
          const effectiveAt = now + delayMs
          return [{ granted: true, delayMs }, { requests: [...recent, effectiveAt], last: effectiveAt }]
        })

        if (!decision.granted) {
          return yield* Effect.fail(ScraperErrors.rateLimitExceeded(Math.ceil(decision.waitMs / 1000)))
        }

        if (decision.delayMs > 0) {
          yield* Effect.sleep(Duration.millis(decision.delayMs))
        }
      })

      return RateLimiterService.of({
        acquire,

        reset: () => Ref.set(stateRef, { requests: [], last: 0 }),

        getStats: () =>
          Effect.gen(function* () {
            const state = yield* Ref.get(stateRef)
            const now = yield* Clock.currentTimeMillis
            const windowStart = now - windowMs
            return {
              requests: state.requests.filter((t) => t > windowStart).length,
              windowMs
            }
          })
      })
    })
  )

/**
 * No-op rate limiter (for disabling rate limiting)
 */
export const RateLimiterDisabled = Layer.succeed(
  RateLimiterService,
  RateLimiterService.of({
    acquire: () => Effect.void,
    reset: () => Effect.void,
    getStats: () => Effect.succeed({ requests: 0, windowMs: 0 })
  })
)
