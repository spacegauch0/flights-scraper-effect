/**
 * Production example with caching, rate limiting, and retry logic
 */

import { Effect, Console, Layer } from "effect"
import { ScraperService, ScraperProductionLive, CacheLive, defaultCacheConfig, RateLimiterLive, defaultRateLimiterConfig } from "./src"
import { FlightFilters, SortOption, TripType, SeatClass, Passengers } from "./src/domain"

const program = Effect.gen(function* () {
  const scraper = yield* ScraperService

  // --- Configuration ---
  const from = "AEP"
  const to = "SLC"
  const departDate = "2026-01-04"
  
  // Set trip type: "one-way" | "round-trip" | "multi-city"
  const tripType: TripType = "one-way"
  const returnDate: string | undefined = undefined
  // For round-trip, set both tripType and returnDate:
  // const tripType: TripType = "round-trip"
  // const returnDate: string | undefined = "2026-01-05"
  
  const sortOption: SortOption = "price-asc"
  
  const filters: FlightFilters = {
    max_stops: 1,
    limit: 10
  }
  
  const seat: SeatClass = "economy"
  
  const passengers: Passengers = {
    adults: 1,
    children: 0,
    infants_in_seat: 0,
    infants_on_lap: 0
  }
  
  const currency = ""
  // --- End Configuration ---

  yield* Console.log(`🕷️  Starting Production Flight Scraper`)
  const tripDescription = returnDate ? ` (Return: ${returnDate})` : ` (${tripType})`
  yield* Console.log(`Route: ${from} -> ${to} on ${departDate}${tripDescription}`)
  yield* Console.log(`👥 Passengers: ${passengers.adults} adult(s), ${passengers.children} child(ren)`)
  yield* Console.log(`💺 Seat class: ${seat}`)
  yield* Console.log(`📊 Sorting by: ${sortOption}`)
  
  const activeFilters = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ")
  
  if (activeFilters) {
    yield* Console.log(`🔍 Filters: ${activeFilters}`)
  }

  yield* Console.log(`\n🚀 Features enabled:`)
  yield* Console.log(`   ✅ Response caching (TTL: ${defaultCacheConfig.ttl! / 1000}s)`)
  yield* Console.log(`   ✅ Rate limiting (${defaultRateLimiterConfig.maxRequests} req/${defaultRateLimiterConfig.windowMs! / 1000}s)`)
  yield* Console.log(`   ✅ Retry with exponential backoff`)
  yield* Console.log(`   ✅ Enhanced error messages\n`)

  // First request
  const result1 = yield* scraper.scrape(from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency)

  yield* Console.log(`\n✅ First request completed`)
  yield* Console.log(`Found ${result1.flights.length} flights`)
  if (result1.current_price) {
    yield* Console.log(`💰 Price level: ${result1.current_price.toUpperCase()}`)
  }

  // Show first 3 flights
  yield* Console.log(`\nTop 3 flights:`)
  result1.flights.slice(0, 3).forEach((f, i) => {
    console.log(`${i + 1}. ${f.name} - ${f.duration} - ${f.stops} stop(s) - ${f.price}`)
  })

  // Second request (should be cached)
  yield* Console.log(`\n⏳ Making second request (should hit cache)...`)
  const result2 = yield* scraper.scrape(from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency)
  
  yield* Console.log(`✅ Second request completed (${result2.flights.length} flights)`)

  // Different route (should fetch new data)
  yield* Console.log(`\n⏳ Making request for different route...`)
  const result3 = yield* scraper.scrape("LAX", "NRT", "2025-12-25", "one-way", undefined, "price-asc", { limit: 5 }, seat, passengers, currency)
  
  yield* Console.log(`✅ Different route completed (${result3.flights.length} flights)`)
})

// Compose all layers
// ScraperProductionLive depends on CacheService and RateLimiterService
const AppLive = ScraperProductionLive.pipe(
  Layer.provide(CacheLive(defaultCacheConfig)),
  Layer.provide(RateLimiterLive(defaultRateLimiterConfig))
)

// Using Effect.match for idiomatic error handling (per Effect docs best practices)
const runnable = program.pipe(
  Effect.provide(AppLive),
  Effect.match({
    onFailure: (error) => {
      console.error("\n--- PROGRAM FAILED ---")
      console.error(error)
      process.exit(1)
    },
    onSuccess: () => {
      console.log("\n--- PROGRAM COMPLETE ---")
      process.exit(0)
    }
  })
)

Effect.runPromise(runnable)
