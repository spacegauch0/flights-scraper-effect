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
 * Rate limiter service interface
 */
export interface RateLimiterService {
  readonly acquire: () => Effect.Effect<void, ScraperError>
  readonly reset: () => Effect.Effect<void>
  readonly getStats: () => Effect.Effect<{ requests: number; windowMs: number }>
}

export const RateLimiterService = Context.GenericTag<RateLimiterService>("RateLimiterService")

/**
 * In-memory rate limiter implementation using sliding window
 */
export const RateLimiterLive = (config: RateLimiterConfig = defaultRateLimiterConfig) =>
  Layer.effect(
    RateLimiterService,
    Effect.gen(function* (_) {
      const { maxRequests = 10, windowMs = 60000, minDelay = 2000 } = config
      
      // Store request timestamps
      const requestsRef = yield* _(Ref.make<RequestRecord[]>([]))
      const lastRequestRef = yield* _(Ref.make<number>(0))

      return RateLimiterService.of({
        acquire: () =>
          Effect.gen(function* (_) {
            const now = Date.now()
            
            // Get current requests within the window
            const requests = yield* _(Ref.get(requestsRef))
            const windowStart = now - windowMs
            const recentRequests = requests.filter(r => r.timestamp > windowStart)

            // Check if we've exceeded the rate limit
            if (recentRequests.length >= maxRequests) {
              const oldestRequest = recentRequests[0]
              const waitTime = oldestRequest.timestamp + windowMs - now
              
              return yield* _(
                Effect.fail(
                  new ScraperError({
                    reason: "Timeout",
                    message: `Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)} seconds before trying again.`
                  })
                )
              )
            }

            // Check minimum delay between requests
            const lastRequest = yield* _(Ref.get(lastRequestRef))
            const timeSinceLastRequest = now - lastRequest
            
            if (timeSinceLastRequest < minDelay && lastRequest > 0) {
              const waitTime = minDelay - timeSinceLastRequest
              yield* _(Effect.sleep(Duration.millis(waitTime)))
            }

            // Update request history
            yield* _(
              Ref.update(requestsRef, () => [
                ...recentRequests,
                { timestamp: Date.now() }
              ])
            )
            
            yield* _(Ref.set(lastRequestRef, Date.now()))
          }),

        reset: () =>
          Effect.gen(function* (_) {
            yield* _(Ref.set(requestsRef, []))
            yield* _(Ref.set(lastRequestRef, 0))
          }),

        getStats: () =>
          Effect.gen(function* (_) {
            const requests = yield* _(Ref.get(requestsRef))
            const now = Date.now()
            const windowStart = now - windowMs
            const recentRequests = requests.filter(r => r.timestamp > windowStart)

            return {
              requests: recentRequests.length,
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

