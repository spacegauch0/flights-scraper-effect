/**
 * Google Flights Scraper - Main exports
 * 
 * A high-performance Google Flights scraper built with TypeScript Effect and Protocol Buffers.
 * 
 * @example
 * ```typescript
 * import { Effect } from "effect"
 * import { ScraperService, ScraperProtobufLive } from "flights-scraper-effect"
 * 
 * const program = Effect.gen(function* () {
 *   const scraper = yield* ScraperService
 *   const result = yield* scraper.scrape("JFK", "LHR", "2026-01-19", "one-way", undefined, "price-asc", { limit: 10 })
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

