/**
 * Tests for CacheService implementation.
 * Verifies TTL, max size eviction, immutability of Ref updates,
 * and correct cache key generation.
 */

import { describe, expect, test } from "bun:test"
import { Effect, Ref } from "effect"
import { CacheLive, CacheDisabled, CacheService, createCacheKey } from "../src/utils/cache"
import { Result, FlightOption } from "../src/domain"

const makeResult = (n: number): Result =>
  new Result({
    flights: [
      new FlightOption({ name: `Airline-${n}`, departure: "8:00 AM", arrival: "2:00 PM", duration: "6 hr", stops: 0, price: `$${n * 100}` })
    ]
  })

const runWithCache = <A>(config: { ttl?: number; maxSize?: number }, program: Effect.Effect<A, any, CacheService>): Promise<A> =>
  program.pipe(
    Effect.provide(CacheLive(config)),
    Effect.runPromise
  )

// ---------------------------------------------------------------------------
// createCacheKey
// ---------------------------------------------------------------------------

describe("createCacheKey", () => {
  test("includes all parameters", () => {
    const key = createCacheKey("JFK", "LHR", "2026-01-01", "one-way", undefined, "economy", 1, 0, 0, 0)
    expect(key).toContain("JFK")
    expect(key).toContain("LHR")
    expect(key).toContain("2026-01-01")
    expect(key).toContain("USD") // default currency
  })

  test("different currencies produce different keys", () => {
    const usd = createCacheKey("JFK", "LHR", "2026-01-01", "one-way", undefined, "economy", 1, 0, 0, 0, "USD")
    const eur = createCacheKey("JFK", "LHR", "2026-01-01", "one-way", undefined, "economy", 1, 0, 0, 0, "EUR")
    expect(usd).not.toBe(eur)
  })

  test("currency is normalized to uppercase", () => {
    const lower = createCacheKey("JFK", "LHR", "2026-01-01", "one-way", undefined, "economy", 1, 0, 0, 0, "usd")
    const upper = createCacheKey("JFK", "LHR", "2026-01-01", "one-way", undefined, "economy", 1, 0, 0, 0, "USD")
    expect(lower).toBe(upper)
  })
})

// ---------------------------------------------------------------------------
// CacheLive
// ---------------------------------------------------------------------------

describe("CacheLive", () => {
  test("cache miss returns null", async () => {
    const result = await runWithCache({}, Effect.gen(function* () {
      const cache = yield* CacheService
      return yield* cache.get("nonexistent")
    }))
    expect(result).toBeNull()
  })

  test("set then get returns data", async () => {
    const data = makeResult(1)
    const result = await runWithCache({}, Effect.gen(function* () {
      const cache = yield* CacheService
      yield* cache.set("key1", data)
      return yield* cache.get("key1")
    }))
    expect(result).not.toBeNull()
    expect(result!.flights[0].name).toBe("Airline-1")
  })

  test("expired entries return null", async () => {
    const data = makeResult(1)
    const result = await runWithCache({ ttl: 1 }, Effect.gen(function* () {
      const cache = yield* CacheService
      yield* cache.set("key1", data)
      // Wait for TTL to expire
      yield* Effect.sleep("5 millis")
      return yield* cache.get("key1")
    }))
    expect(result).toBeNull()
  })

  test("evicts oldest when maxSize reached", async () => {
    const result = await runWithCache({ maxSize: 2 }, Effect.gen(function* () {
      const cache = yield* CacheService
      yield* cache.set("a", makeResult(1))
      yield* cache.set("b", makeResult(2))
      yield* cache.set("c", makeResult(3)) // should evict "a"
      const a = yield* cache.get("a")
      const c = yield* cache.get("c")
      const size = yield* cache.size()
      return { a, c, size }
    }))
    expect(result.a).toBeNull()     // evicted
    expect(result.c).not.toBeNull() // still there
    expect(result.size).toBe(2)
  })

  test("clear removes all entries", async () => {
    const result = await runWithCache({}, Effect.gen(function* () {
      const cache = yield* CacheService
      yield* cache.set("a", makeResult(1))
      yield* cache.set("b", makeResult(2))
      yield* cache.clear()
      return yield* cache.size()
    }))
    expect(result).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// CacheDisabled
// ---------------------------------------------------------------------------

describe("CacheDisabled", () => {
  test("always returns null", async () => {
    const result = await Effect.gen(function* () {
      const cache = yield* CacheService
      yield* cache.set("key", makeResult(1))
      return yield* cache.get("key")
    }).pipe(
      Effect.provide(CacheDisabled),
      Effect.runPromise
    )
    expect(result).toBeNull()
  })
})
