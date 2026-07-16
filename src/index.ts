/**
 * Google Flights Scraper - public library surface.
 *
 * Intentional exports only: the ScraperService seam with its adapters, the
 * request/response schemas needed to use it, the booking-options and
 * multi-city extensions, and the rate limiter the production adapter needs.
 * Parsing internals, page fetching, and TUI modules are implementation.
 *
 * @example
 * ```typescript
 * import { Effect, Layer, Schema } from "effect"
 * import { FetchHttpClient } from "effect/unstable/http"
 * import { ScraperService, ScraperProtobufLive, ScrapeRequestSchema } from "flights-scraper-effect"
 *
 * const program = Effect.gen(function* () {
 *   const request = yield* Schema.decodeUnknownEffect(ScrapeRequestSchema)({
 *     from: "JFK", to: "LHR", departDate: "2026-01-19", tripType: "one-way",
 *     sortOption: "price-asc", filters: { limit: 10 }, seat: "economy",
 *     passengers: { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }
 *   })
 *   const scraper = yield* ScraperService
 *   const result = yield* scraper.scrape(request)
 *   console.log(`Found ${result.flights.length} flights`)
 * })
 *
 * Effect.runPromise(program.pipe(
 *   Effect.provide(ScraperProtobufLive.pipe(Layer.provide(FetchHttpClient.layer)))
 * ))
 * ```
 */

// The scraper seam and its adapters
export { ScraperService } from "./services/scraper"
export { ScraperProtobufLive } from "./services/scraper-protobuf"
export { ScraperProductionLive } from "./services/scraper-production"
export { ScraperMockLive } from "./services/scraper-mock"

// Request/response contract
export {
  ScrapeRequestSchema,
  type ScrapeRequest,
  FlightOption,
  Result,
  BookingOption,
  FlightFiltersSchema,
  type FlightFilters,
  PassengersSchema,
  type Passengers,
  TripTypeSchema,
  type TripType,
  SeatClassSchema,
  type SeatClass,
  SortOptionSchema,
  type SortOption,
  AirportCodeSchema,
  type AirportCode,
  DateStringSchema,
  type DateString,
  FlightLegSchema,
  type FlightLeg,
} from "./domain/types"
export { ScraperError } from "./domain/errors"

// Booking options for a specific flight
export { fetchBookingOptions, type BookingOptionsParams } from "./services/booking-options"

// Multi-city
export { fetchMultiCityItinerary, type MultiCityParams } from "./services/multi-city"

// Rate limiter (required by ScraperProductionLive)
export { RateLimiterService, RateLimiterLive, RateLimiterDisabled, defaultRateLimiterConfig, type RateLimiterConfig } from "./utils/rate-limiter"
