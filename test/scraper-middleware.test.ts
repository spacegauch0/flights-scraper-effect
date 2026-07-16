/**
 * The production middleware through the ScraperService seam: caching,
 * concurrent dedupe, raw-result caching (client-side filters applied per
 * call), and rate limiting - all against a counting fake inner adapter,
 * no network.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { FlightOption, Result, ScrapeRequestSchema, type ScrapeRequest } from "../src/domain"
import { ScraperCacheMiddleware } from "../src/services/scraper-production"
import { ScraperService } from "../src/services/scraper"
import { RateLimiterDisabled, RateLimiterLive } from "../src/utils/rate-limiter"

const request = (overrides: Record<string, unknown> = {}): ScrapeRequest =>
  Schema.decodeUnknownSync(ScrapeRequestSchema)({
    from: "JFK", to: "LHR", departDate: "2026-08-20", tripType: "one-way",
    sortOption: "price-asc", filters: { limit: 10 }, seat: "economy",
    passengers: { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
    ...overrides,
  })

const FLIGHTS = [
  FlightOption.make({ name: "Delta", departure: "", arrival: "", duration: "10 hr", stops: 1, price: "$300" }),
  FlightOption.make({ name: "United", departure: "", arrival: "", duration: "7 hr", stops: 0, price: "$450" }),
  FlightOption.make({ name: "Iberia", departure: "", arrival: "", duration: "15 hr", stops: 2, price: "$150" }),
]

/** Inner adapter that counts calls and returns the full raw set */
const countingInner = () => {
  let calls = 0
  const layer = Layer.succeed(
    ScraperService,
    ScraperService.of({
      scrape: () =>
        Effect.sync(() => {
          calls += 1
        }).pipe(Effect.as(Result.make({ current_price: "typical", flights: FLIGHTS })))
    })
  )
  return { layer, calls: () => calls }
}

const run = <A>(inner: Layer.Layer<ScraperService>, rateLimiter: Layer.Layer<never, never, never> | typeof RateLimiterDisabled, body: Effect.Effect<A, unknown, ScraperService>) =>
  Effect.runPromise(
    body.pipe(
      Effect.provide(ScraperCacheMiddleware.pipe(Layer.provide(inner), Layer.provide(rateLimiter)))
    ) as Effect.Effect<A>
  )

describe("ScraperCacheMiddleware", () => {
  test("identical searches share one inner fetch", async () => {
    const inner = countingInner()
    await run(inner.layer, RateLimiterDisabled, Effect.gen(function* () {
      const scraper = yield* ScraperService
      yield* scraper.scrape(request())
      yield* scraper.scrape(request())
    }))
    expect(inner.calls()).toBe(1)
  })

  test("concurrent identical searches dedupe into one fetch", async () => {
    const inner = countingInner()
    await run(inner.layer, RateLimiterDisabled, Effect.gen(function* () {
      const scraper = yield* ScraperService
      yield* Effect.all([scraper.scrape(request()), scraper.scrape(request())], { concurrency: "unbounded" })
    }))
    expect(inner.calls()).toBe(1)
  })

  test("fetch-affecting parameters miss the cache", async () => {
    const inner = countingInner()
    await run(inner.layer, RateLimiterDisabled, Effect.gen(function* () {
      const scraper = yield* ScraperService
      yield* scraper.scrape(request())
      yield* scraper.scrape(request({ filters: { limit: 10, max_stops: 0 } }))
    }))
    expect(inner.calls()).toBe(2)
  })

  test("the raw set is cached: client-side filters and sorting apply per call", async () => {
    const inner = countingInner()
    const [limited, sortedAll] = await run(inner.layer, RateLimiterDisabled, Effect.gen(function* () {
      const scraper = yield* ScraperService
      const first = yield* scraper.scrape(request({ filters: { limit: 1 }, sortOption: "price-asc" }))
      const second = yield* scraper.scrape(request({ filters: { limit: 10 }, sortOption: "price-desc" }))
      return [first, second]
    }))

    expect(inner.calls()).toBe(1)
    expect(limited.flights.map((f) => f.name)).toEqual(["Iberia"])
    expect(sortedAll.flights.map((f) => f.name)).toEqual(["United", "Delta", "Iberia"])
  })

  test("rate limiting applies to fetches, not cache hits", async () => {
    const inner = countingInner()
    const exits = await run(
      inner.layer,
      RateLimiterLive({ maxRequests: 1, windowMs: 60_000, minDelay: 0 }),
      Effect.gen(function* () {
        const scraper = yield* ScraperService
        const first = yield* scraper.scrape(request()).pipe(Effect.exit)
        // Cache hit: must not need a slot
        const second = yield* scraper.scrape(request()).pipe(Effect.exit)
        // New search: needs a slot, and the window is exhausted
        const third = yield* scraper.scrape(request({ to: "CDG" })).pipe(Effect.exit)
        return [first, second, third]
      })
    )

    expect(exits.map(Exit.isSuccess)).toEqual([true, true, false])
    expect(inner.calls()).toBe(1)
  })
})
