/**
 * Response caching for flight search results
 */

import { Effect, Layer, Context, Ref } from "effect"
import { Result } from "../domain"

/**
 * Cache entry with timestamp
 */
interface CacheEntry {
  data: Result
  timestamp: number
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Time-to-live in milliseconds (default: 15 minutes) */
  ttl?: number
  /** Maximum cache size (default: 100 entries) */
  maxSize?: number
}

/**
 * Default cache configuration
 */
export const defaultCacheConfig: CacheConfig = {
  ttl: 15 * 60 * 1000, // 15 minutes
  maxSize: 100
}

/**
 * Cache service interface
 */
export interface CacheService {
  readonly get: (key: string) => Effect.Effect<Result | null>
  readonly set: (key: string, value: Result) => Effect.Effect<void>
  readonly clear: () => Effect.Effect<void>
  readonly size: () => Effect.Effect<number>
}

export const CacheService = Context.GenericTag<CacheService>("CacheService")

/**
 * Creates a cache key from search parameters
 */
export const createCacheKey = (
  from: string,
  to: string,
  departDate: string,
  tripType: string,
  returnDate: string | undefined,
  seat: string,
  adults: number,
  children: number,
  infants_in_seat: number,
  infants_on_lap: number
): string => {
  const params = [
    from,
    to,
    departDate,
    tripType,
    returnDate || "none",
    seat,
    adults,
    children,
    infants_in_seat,
    infants_on_lap
  ]
  return params.join("|")
}

/**
 * In-memory cache implementation
 */
export const CacheLive = (config: CacheConfig = defaultCacheConfig) =>
  Layer.effect(
    CacheService,
    Effect.gen(function* () {
      const { ttl = 15 * 60 * 1000, maxSize = 100 } = config
      
      // Create a ref to hold the cache
      const cacheRef = yield* Ref.make(new Map<string, CacheEntry>())

      return CacheService.of({
        get: (key: string) =>
          Effect.gen(function* () {
            const cache = yield* Ref.get(cacheRef)
            const entry = cache.get(key)

            if (!entry) {
              return null
            }

            // Check if entry is expired
            const now = Date.now()
            if (now - entry.timestamp > ttl) {
              // Remove expired entry
              yield* Ref.update(cacheRef, (cache) => {
                cache.delete(key)
                return cache
              })
              return null
            }

            return entry.data
          }),

        set: (key: string, value: Result) =>
          Effect.gen(function* () {
            const now = Date.now()

            yield* Ref.update(cacheRef, (cache) => {
              // Remove oldest entry if cache is full
              if (cache.size >= maxSize) {
                let oldestKey: string | null = null
                let oldestTime = Infinity

                for (const [k, v] of cache.entries()) {
                  if (v.timestamp < oldestTime) {
                    oldestTime = v.timestamp
                    oldestKey = k
                  }
                }

                if (oldestKey) {
                  cache.delete(oldestKey)
                }
              }

              // Add new entry
              cache.set(key, { data: value, timestamp: now })
              return cache
            })
          }),

        clear: () =>
          Effect.gen(function* () {
            yield* Ref.set(cacheRef, new Map())
          }),

        size: () =>
          Effect.gen(function* () {
            const cache = yield* Ref.get(cacheRef)
            return cache.size
          })
      })
    })
  )

/**
 * No-op cache implementation (for disabling caching)
 */
export const CacheDisabled = Layer.succeed(
  CacheService,
  CacheService.of({
    get: () => Effect.succeed(null),
    set: () => Effect.void,
    clear: () => Effect.void,
    size: () => Effect.succeed(0)
  })
)

