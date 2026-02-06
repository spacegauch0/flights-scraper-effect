/**
 * Google Flights scraper using Protocol Buffers (HTTP-based, no browser)
 * Inspired by: https://github.com/AWeirdDev/flights
 */

import { Effect, Layer, Duration } from "effect"
import { HttpClient } from "@effect/platform"
import { ScraperError, Result, SeatClass, Passengers } from "../domain"
import { ScraperService } from "./scraper"
import { encodeFlightSearch, FlightData as ProtobufFlightData } from "../utils/protobuf"
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
 * Fetches the Google Flights HTML via HTTP using Effect Platform HttpClient
 */
const fetchFlightsHtml = (url: string): Effect.Effect<string, ScraperError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    const response = yield* client.get(url, {
      headers: GOOGLE_FLIGHTS_HEADERS
    }).pipe(
      Effect.timeout(Duration.seconds(30)),
      Effect.catchTag("TimeoutException", () =>
        Effect.fail(new ScraperError({ reason: "Timeout", message: `HTTP request timed out after 30s: ${url}` }))
      ),
      Effect.mapError((error) =>
        error instanceof ScraperError ? error :
        new ScraperError({ reason: "NavigationFailed", message: `Failed to fetch ${url}: ${String(error)}` })
      )
    )

    const body = yield* response.text.pipe(
      Effect.timeout(Duration.seconds(15)),
      Effect.catchTag("TimeoutException", () =>
        Effect.fail(new ScraperError({ reason: "Timeout", message: `Response body read timed out after 15s` }))
      ),
      Effect.mapError((error) =>
        error instanceof ScraperError ? error :
        new ScraperError({ reason: "NavigationFailed", message: `Failed to read response body: ${String(error)}` })
      )
    )

    return body
  })

/**
 * Creates the ScraperService implementation using Protobuf encoding.
 * Requires HttpClient to be provided via Layer.
 */
export const ScraperProtobufLive: Layer.Layer<ScraperService, never, HttpClient.HttpClient> = Layer.effect(
  ScraperService,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient

    return {
      scrape: (from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency) =>
        Effect.gen(function* () {
          // Validate input
          if (tripType === "round-trip" && !returnDate) {
            return yield* Effect.fail(new ScraperError({ reason: "InvalidInput", message: "Return date is required for round-trip flights." }))
          }

          // Default values
          const seatClass: SeatClass = seat || "economy"
          const passengerCounts: Passengers = passengers || { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }
          const curr = currency || "USD"

          // Build flight data
          const flightData: ProtobufFlightData[] = [
            { date: departDate, from_airport: from, to_airport: to, max_stops: filters.max_stops, airlines: filters.airlines }
          ]

          if (tripType === "round-trip" && returnDate) {
            flightData.push({ date: returnDate, from_airport: to, to_airport: from, max_stops: filters.max_stops, airlines: filters.airlines })
          }

          // Encode to tfs parameter and build URL
          const tfs = yield* encodeFlightSearch(flightData, tripType, seatClass, passengerCounts)
          const params = new URLSearchParams({ tfs, hl: "en", tfu: "EgQIABABIgA" })
          if (curr) params.set("curr", curr)
          const url = `https://www.google.com/travel/flights?${params.toString()}`

          yield* Effect.logDebug(`Fetching flights via HTTP: ${url.substring(0, 100)}...`)

          // Fetch HTML
          const html = yield* fetchFlightsHtml(url).pipe(
            Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
          )
          yield* Effect.logDebug(`Received ${html.length} bytes of HTML`)

          // Parse HTML
          const result = yield* extractFlightsFromHtml(html)
          yield* Effect.logDebug(`Extracted ${result.flights.length} raw flight entries`)

          if (result.current_price) {
            yield* Effect.logDebug(`Price indicator: ${result.current_price}`)
          }

          // Apply filters, sorting, and limit
          return applyFiltersAndSort(result, filters, sortOption)
        })
    }
  })
)
