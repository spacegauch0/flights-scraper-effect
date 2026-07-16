/**
 * Google Flights scraper using Protocol Buffers (HTTP-based, no browser)
 * Inspired by: https://github.com/AWeirdDev/flights
 */

import { Effect, Layer, Console, Schedule } from "effect"
import { HttpClient } from "effect/unstable/http"
import { ScrapeRequest, ScraperErrors } from "../domain"
import { ScraperService } from "./scraper"
import { buildFlightUrl, FlightData as ProtobufFlightData } from "../utils/protobuf"
import { applyFiltersSortAndLimit } from "./flight-parsing"
import { fetchMultiCityItinerary } from "./multi-city"
import { extractFlights, fetchSearchPage } from "./search-page"

/**
 * Creates the ScraperService implementation using Protobuf encoding
 * Requires HttpClient to be provided via Layer
 */
export const ScraperProtobufLive = Layer.effect(
  ScraperService,
  Effect.gen(function* () {
    // Classify HTTP status up front (a 429/5xx/consent page must fail as a
    // typed error instead of parsing as an empty flight list) and retry
    // transient failures with jittered exponential backoff.
    const httpClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({
        times: 3,
        schedule: Schedule.exponential("1 second").pipe(Schedule.jittered),
      }),
    )

    return ScraperService.of({
      scrape: Effect.fn("Scraper.scrape")(
        function* (request: ScrapeRequest) {
          const { from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency, additionalLegs } = request

          // Validate cross-field rules the schema can't express
          if (tripType === "round-trip" && !returnDate) {
            return yield* Effect.fail(ScraperErrors.invalidInput("returnDate", "Return date is required for round-trip flights."))
          }
          if (tripType === "multi-city" && (!additionalLegs || additionalLegs.length === 0)) {
            return yield* Effect.fail(ScraperErrors.invalidInput("additionalLegs", "At least one additional leg is required for multi-city flights."))
          }

          // Multi-city has no single-request result set - it's a step-by-step
          // wizard on Google's side, so it gets its own chained-request path.
          if (tripType === "multi-city" && additionalLegs) {
            yield* Console.log(`🚀 Scraping multi-city itinerary (${additionalLegs.length + 1} legs)...`)
            return yield* fetchMultiCityItinerary({
              from,
              to,
              departDate,
              additionalLegs,
              seat,
              passengers,
              currency,
            })
          }

          // Build flight data
          const flightData: ProtobufFlightData[] = [
            {
              date: departDate,
              from_airport: from,
              to_airport: to,
              max_stops: filters.max_stops,
              airlines: filters.airlines,
            },
          ]

          // Add return flight for round-trip
          if (tripType === "round-trip" && returnDate) {
            flightData.push({
              date: returnDate,
              from_airport: to,
              to_airport: from,
              max_stops: filters.max_stops,
              airlines: filters.airlines,
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

          return applyFiltersSortAndLimit(result, filters, sortOption)
        },
        // The whole scrape runs against this adapter's status-classified client
        (effect) => Effect.provideService(effect, HttpClient.HttpClient, httpClient),
      ),
    })
  }),
)
