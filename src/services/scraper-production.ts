/**
 * Production middleware for the ScraperService seam: wraps ANY inner
 * ScraperService with response caching and rate limiting. The inner adapter
 * owns fetching and parsing; this layer owns when not to fetch.
 *
 * The cache stores the raw (pre client-side filtering) result set, keyed by
 * every fetch-affecting parameter, and post-processing (price/duration
 * filters, sorting, limit) is applied per call - so two searches differing
 * only in their client-side filters share one fetch.
 */

import { Cache, Console, Duration, Effect, Equal, Exit, Hash, Layer } from "effect"
import { Result, ScrapeRequest, ScraperError } from "../domain"
import { RateLimiterService } from "../utils/rate-limiter"
import { applyFiltersSortAndLimit } from "./flight-parsing"
import { ScraperService } from "./scraper"
import { ScraperProtobufLive } from "./scraper-protobuf"

const CACHE_CAPACITY = 100
const CACHE_TTL = Duration.minutes(15)

/**
 * Cache key: a canonical id covering every parameter that changes the fetched
 * page (route, dates, trip type, seat, passengers, currency, pre-filters,
 * legs), paired with the effect that computes the result on a miss. Equality
 * and hashing go through the id, so identical concurrent searches share one
 * in-flight fetch.
 */
class SearchKey implements Equal.Equal {
  constructor(
    readonly id: string,
    readonly compute: Effect.Effect<Result, ScraperError>
  ) {}

  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof SearchKey && that.id === this.id
  }

  [Hash.symbol](): number {
    return Hash.string(this.id)
  }
}

const searchId = (request: ScrapeRequest): string => {
  const { from, to, departDate, tripType, returnDate, filters, seat, passengers, currency, additionalLegs } = request
  return [
    from,
    to,
    departDate,
    tripType,
    returnDate ?? "none",
    seat,
    passengers.adults,
    passengers.children,
    passengers.infants_in_seat,
    passengers.infants_on_lap,
    currency ?? "none",
    filters.max_stops ?? "any",
    filters.airlines && filters.airlines.length > 0 ? [...filters.airlines].sort().join("+") : "any",
    additionalLegs?.map((leg) => `${leg.from}-${leg.to}-${leg.date}`).join(",") ?? ""
  ].join("|")
}

/**
 * The request the inner adapter fetches with: fetch-affecting filters only
 * (max_stops and airlines are encoded into the search itself), no sorting,
 * no client-side narrowing - so the cached result is the full raw set.
 */
const rawRequest = (request: ScrapeRequest): ScrapeRequest => ({
  ...request,
  sortOption: "none",
  filters: {
    ...(request.filters.max_stops !== undefined && { max_stops: request.filters.max_stops }),
    ...(request.filters.airlines !== undefined && { airlines: [...request.filters.airlines] }),
  },
})

/**
 * Caching + rate limiting around whatever ScraperService it is given.
 * Compose with an inner adapter via Layer.provide.
 */
export const ScraperCacheMiddleware: Layer.Layer<ScraperService, never, ScraperService | RateLimiterService> =
  Layer.effect(
    ScraperService,
    Effect.gen(function* () {
      const inner = yield* ScraperService
      const rateLimiter = yield* RateLimiterService

      // Only successes are cached: a zero TTL on failure keeps transient
      // errors out of the cache.
      const cache = yield* Cache.makeWith((key: SearchKey) => key.compute, {
        capacity: CACHE_CAPACITY,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? CACHE_TTL : Duration.zero),
      })

      return ScraperService.of({
        scrape: Effect.fn("Scraper.scrapeCached")(function* (request: ScrapeRequest) {
          // Rate-limit acquisition happens inside the computed effect so
          // cache hits never consume a request slot.
          const fetchRaw = Effect.gen(function* () {
            yield* rateLimiter.acquire()
            return yield* inner.scrape(rawRequest(request))
          })

          const key = new SearchKey(searchId(request), fetchRaw)
          const hit = yield* Cache.has(cache, key)
          const result = yield* Cache.get(cache, key)
          yield* Console.log(hit ? "📦 Cache hit! Using cached results" : "💾 Cached fresh search results")

          // Multi-city results are already exactly the chosen itinerary
          return request.tripType === "multi-city"
            ? result
            : applyFiltersSortAndLimit(result, request.filters, request.sortOption)
        }),
      })
    })
  )

/**
 * The production adapter: the protobuf scraper behind the caching and
 * rate-limiting middleware. Requires RateLimiterService and HttpClient.
 */
export const ScraperProductionLive = ScraperCacheMiddleware.pipe(
  Layer.provide(ScraperProtobufLive)
)
