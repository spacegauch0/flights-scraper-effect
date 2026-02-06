/**
 * Production-ready scraper with caching, rate limiting, and retry logic
 */

import { Effect, Layer, Duration } from "effect"
import { HttpClient } from "@effect/platform"
import { ScraperService } from "./scraper"
import { ScraperError, ScraperErrors, Result, SeatClass, Passengers } from "../domain"
import { encodeFlightSearch, FlightData as ProtobufFlightData } from "../utils/protobuf"
import { CacheService, createCacheKey } from "../utils/cache"
import { RateLimiterService } from "../utils/rate-limiter"
import { withRetryAndLog } from "../utils/retry"
import { extractFlightsFromHtml, applyFiltersAndSort } from "./parsing"

/**
 * Shared request headers for Google Flights HTTP requests
 */
const GOOGLE_FLIGHTS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Cache-Control": "max-age=0",
  "Cookie": "CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg"
} as const

/**
 * Fetches the Google Flights HTML via HTTP with retry logic.
 * Requires RateLimiterService and HttpClient in context.
 */
const fetchFlightsHtml = (url: string): Effect.Effect<string, ScraperError, RateLimiterService | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    // Acquire rate limit token
    const rateLimiter = yield* RateLimiterService
    yield* rateLimiter.acquire()

    // Fetch with retry
    return yield* withRetryAndLog(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient

        const response = yield* client.get(url, {
          headers: GOOGLE_FLIGHTS_HEADERS
        }).pipe(
          Effect.timeout(Duration.seconds(30)),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(ScraperErrors.timeout(`HTTP request to ${url}`))
          ),
          Effect.mapError((error) =>
            error instanceof ScraperError ? error : ScraperErrors.navigationFailed(url, String(error))
          )
        )

        const body = yield* response.text.pipe(
          Effect.timeout(Duration.seconds(15)),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(ScraperErrors.timeout(`Response body read from ${url}`))
          ),
          Effect.mapError((error) =>
            error instanceof ScraperError ? error : ScraperErrors.navigationFailed(url, `Failed to read response: ${String(error)}`)
          )
        )

        return body
      }),
      "Fetch Google Flights HTML"
    )
  })

/**
 * Production-ready scraper implementation with caching, rate limiting, and retry.
 * Requires CacheService, RateLimiterService, and HttpClient to be provided via Layer.
 */
export const ScraperProductionLive: Layer.Layer<ScraperService, never, CacheService | RateLimiterService | HttpClient.HttpClient> = Layer.effect(
  ScraperService,
  Effect.gen(function* () {
    const cache = yield* CacheService
    const rateLimiter = yield* RateLimiterService
    const httpClient = yield* HttpClient.HttpClient

    return {
      scrape: (from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency) =>
        Effect.gen(function* () {
          // Validate input
          if (tripType === "round-trip" && !returnDate) {
            return yield* Effect.fail(ScraperErrors.invalidInput("returnDate", "Return date is required for round-trip flights"))
          }

          // Defaults
          const seatClass: SeatClass = seat || "economy"
          const passengerCounts: Passengers = passengers || { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }
          const curr = currency || "USD"

          // Check cache
          const cacheKey = createCacheKey(
            from, to, departDate, tripType, returnDate,
            seatClass,
            passengerCounts.adults,
            passengerCounts.children,
            passengerCounts.infants_in_seat,
            passengerCounts.infants_on_lap,
            curr
          )

          const cached = yield* cache.get(cacheKey)
          if (cached) {
            yield* Effect.log("Cache hit, using cached results")
            return applyFiltersAndSort(cached, filters, sortOption)
          }

          yield* Effect.log("Cache miss, fetching from Google Flights")

          // Build flight data
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

          // Encode to tfs parameter and build URL
          const tfs = yield* encodeFlightSearch(flightData, tripType, seatClass, passengerCounts)
          const params = new URLSearchParams({ tfs, hl: "en", tfu: "EgQIABABIgA" })
          if (curr) params.set("curr", curr)
          const url = `https://www.google.com/travel/flights?${params.toString()}`

          yield* Effect.logDebug(`Fetching flights via HTTP: ${url.substring(0, 100)}...`)

          // Fetch HTML
          const html = yield* fetchFlightsHtml(url).pipe(
            Effect.provide(Layer.succeed(RateLimiterService, rateLimiter)),
            Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
          )
          yield* Effect.logDebug(`Received ${html.length} bytes of HTML`)

          // Parse HTML
          const result = yield* extractFlightsFromHtml(html)
          yield* Effect.logDebug(`Extracted ${result.flights.length} raw flight entries`)

          if (result.current_price) {
            yield* Effect.logDebug(`Price indicator: ${result.current_price}`)
          }

          // Cache the raw results
          yield* cache.set(cacheKey, result)
          yield* Effect.logDebug("Cached search results")

          // Apply filters, sorting, and limit
          return applyFiltersAndSort(result, filters, sortOption)
        })
    }
  })
)
