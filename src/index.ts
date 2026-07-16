/**
 * Google Flights Scraper - Main exports
 * 
 * A high-performance Google Flights scraper built with TypeScript Effect and Protocol Buffers.
 * 
 * @example
 * ```typescript
 * import { Effect, Schema } from "effect"
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
 * Effect.runPromise(program.pipe(Effect.provide(ScraperProtobufLive)))
 * ```
 */

// Domain exports
export * from "./domain"

// Service exports
export * from "./services"

// Utility exports
export * from "./utils"

