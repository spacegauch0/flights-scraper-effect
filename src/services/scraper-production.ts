/**
 * Production-ready scraper with caching, rate limiting, and retry logic
 */

import { Cache, Console, Duration, Effect, Equal, Exit, Hash, Layer, Schedule } from "effect"
import { HttpClient } from "effect/unstable/http"
import { ScraperService } from "./scraper"
import { Result, ScrapeRequest, ScraperError, ScraperErrors } from "../domain"
import { buildFlightUrl, FlightData as ProtobufFlightData } from "../utils/protobuf"
import { RateLimiterService } from "../utils/rate-limiter"
import { applyFiltersSortAndLimit } from "./flight-parsing"
import { fetchMultiCityItinerary } from "./multi-city"
import { extractFlights, fetchSearchPage } from "./search-page"

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
 * Production-ready scraper implementation with caching, rate limiting, and retry
 * Requires RateLimiterService and HttpClient to be provided via Layer
 */
export const ScraperProductionLive = Layer.effect(
  ScraperService,
  Effect.gen(function* () {
    const rateLimiter = yield* RateLimiterService

    // Classify status before parsing (a 429/5xx/consent page is a typed
    // failure, not an empty flight list) and retry transient failures with
    // jittered exponential backoff.
    const httpClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({
        times: 3,
        schedule: Schedule.exponential("1 second").pipe(Schedule.jittered)
      })
    )

    // Raw (pre client-side filtering) results per search. Only successes are
    // cached: a zero TTL on failure keeps transient errors out of the cache.
    const cache = yield* Cache.makeWith((key: SearchKey) => key.compute, {
      capacity: CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? CACHE_TTL : Duration.zero)
    })

    return ScraperService.of({
      scrape: Effect.fn("Scraper.scrape")(function* (request: ScrapeRequest) {
        const { from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency, additionalLegs } = request

        // Validate cross-field rules the schema can't express
        if (tripType === "round-trip" && !returnDate) {
          return yield* Effect.fail(ScraperErrors.invalidInput("returnDate", "Return date is required for round-trip flights"))
        }
        if (tripType === "multi-city" && (!additionalLegs || additionalLegs.length === 0)) {
          return yield* Effect.fail(ScraperErrors.invalidInput("additionalLegs", "At least one additional leg is required for multi-city flights."))
        }

        // Rate-limit acquisition happens inside the computed effect so cache
        // hits never consume a request slot. Multi-city is rate-limited as a
        // single unit rather than per sub-request.
        const fetchFresh: Effect.Effect<Result, ScraperError, HttpClient.HttpClient> =
          tripType === "multi-city" && additionalLegs
            ? Effect.gen(function* () {
                yield* rateLimiter.acquire()
                yield* Console.log(`🚀 Scraping multi-city itinerary (${additionalLegs.length + 1} legs)...`)
                return yield* fetchMultiCityItinerary({ from, to, departDate, additionalLegs, seat, passengers, currency })
              })
            : Effect.gen(function* () {
                yield* rateLimiter.acquire()

                const flightData: ProtobufFlightData[] = [{
                  date: departDate,
                  from_airport: from,
                  to_airport: to,
                  max_stops: filters.max_stops,
                  airlines: filters.airlines
                }]

                if (tripType === "round-trip" && returnDate) {
                  flightData.push({
                    date: returnDate,
                    from_airport: to,
                    to_airport: from,
                    max_stops: filters.max_stops,
                    airlines: filters.airlines
                  })
                }

                const url = yield* buildFlightUrl(flightData, tripType, seat, passengers, currency ?? "")

                yield* Console.log(`🚀 Fetching flights via HTTP: ${url.substring(0, 100)}...`)

                const html = yield* fetchSearchPage(url)
                yield* Console.log(`📄 Received ${html.length} bytes of HTML`)

                const result = yield* extractFlights(html)
                yield* Console.log(`✈️  Extracted ${result.flights.length} raw flight entries`)

                if (result.current_price) {
                  yield* Console.log(`💰 Price indicator: ${result.current_price}`)
                }

                return result
              })

        const key = new SearchKey(
          searchId(request),
          fetchFresh.pipe(Effect.provideService(HttpClient.HttpClient, httpClient))
        )

        const hit = yield* Cache.has(cache, key)
        const result = yield* Cache.get(cache, key)
        yield* Console.log(hit ? "📦 Cache hit! Using cached results" : "💾 Cached fresh search results")

        return tripType === "multi-city"
          ? result
          : applyFiltersSortAndLimit(result, filters, sortOption)
      })
    })
  })
)
