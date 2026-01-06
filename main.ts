/**
 * Main entry point for the Google Flights scraper
 */

import { Effect, Console, Exit } from "effect"
import { ScraperService, ScraperProtobufLive } from "./src"
import { FlightFilters, SortOption, TripType, SeatClass, Passengers } from "./src/domain"

const program = Effect.gen(function* (_) {
  const scraper = yield* _(ScraperService)

  // --- Configuration ---
  const from = "AEP"
  const to = "SCL"
  const departDate = "2026-01-04"
  
  // Set trip type: "one-way" | "round-trip" | "multi-city"
  // const tripType: TripType = "one-way"
  // const returnDate: string | undefined = undefined
  // For round-trip, uncomment these lines:
  const tripType: TripType = "round-trip"
  const returnDate: string | undefined = "2026-01-05"
  
  const sortOption: SortOption = "price-asc"
  
  const filters: FlightFilters = {
    // maxPrice: 800,
    // minPrice: 100,
    // maxDurationMinutes: 10 * 60, // 10 hours
    // airlines: ["United", "American"],
    // nonstopOnly: true,
    max_stops: 1, // 0 = nonstop, 1 = up to 1 stop, 2 = up to 2 stops
    limit: 10 // number or "all"
  }
  
  const seat: SeatClass = "economy" // "economy" | "premium-economy" | "business" | "first"
  
  const passengers: Passengers = {
    adults: 1,
    children: 0,
    infants_in_seat: 0,
    infants_on_lap: 0
  }
  
  const currency = "" // e.g., "USD", "EUR", "GBP" (empty = default)
  // --- End Configuration ---

  const tripDescription = returnDate ? ` (Return: ${returnDate})` : ` (${tripType})`
  yield* _(Console.log(`🕷️  Starting Flight Scraper: ${from} -> ${to} on ${departDate}${tripDescription}`))
  yield* _(Console.log(`👥 Passengers: ${passengers.adults} adult(s), ${passengers.children} child(ren), ${passengers.infants_in_seat} infant(s) in seat, ${passengers.infants_on_lap} infant(s) on lap`))
  yield* _(Console.log(`💺 Seat class: ${seat}`))
  yield* _(Console.log(`📊 Sorting by: ${sortOption}`))
  
  const activeFilters = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ")
  
  if (activeFilters) {
    yield* _(Console.log(`🔍 Filters active - ${activeFilters}`))
  }

  const result = yield* _(scraper.scrape(from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency))

  if (result.flights.length === 0) {
    yield* _(Console.warn("❌ Scraper finished but found no flight results."))
  } else {
    yield* _(Console.log(`\n✅ Successfully found ${result.flights.length} flight options:`))
    
    if (result.current_price) {
      yield* _(Console.log(`💰 Price level: ${result.current_price.toUpperCase()}\n`))
    }
    
    result.flights.forEach((f, i) => {
      const bestBadge = f.is_best ? "⭐ " : ""
      const departureArrival = f.departure && f.arrival ? `${f.departure} → ${f.arrival}` : ""
      const timeAhead = f.arrival_time_ahead ? ` (${f.arrival_time_ahead})` : ""
      const stopsText = f.stops === 0 ? "Nonstop" : `${f.stops} stop${f.stops > 1 ? "s" : ""}`
      const delay = f.delay ? ` | Delay: ${f.delay}` : ""
      
      console.log(`${i + 1}. ${bestBadge}${f.name}`)
      console.log(`   ${departureArrival}${timeAhead}`)
      console.log(`   ${f.duration} | ${stopsText} | ${f.price}${delay}`)
      console.log("")
    })
  }
})

Effect.runPromiseExit(
  program.pipe(Effect.provide(ScraperProtobufLive))
).then(exit => {
  if (Exit.isFailure(exit)) {
    console.error("\n--- PROGRAM FAILED ---")
    console.error(exit.cause)
    process.exit(1)
  } else {
    console.log("--- PROGRAM COMPLETE ---")
    process.exit(0)
  }
})
