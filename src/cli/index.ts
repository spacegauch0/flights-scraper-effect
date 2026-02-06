/**
 * CLI interface for Google Flights Scraper
 * Accepts command-line arguments and returns flight search results
 */

import { Effect, Console, Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { ScraperService, ScraperProtobufLive, ScraperProductionLive } from "../services"
import { CacheLive, RateLimiterLive, defaultCacheConfig, defaultRateLimiterConfig } from "../utils"
import type { TripType, SeatClass, Passengers, FlightFilters, SortOption } from "../domain"

/**
 * CLI Arguments interface
 */
interface CliArgs {
  from?: string
  to?: string
  departDate?: string
  tripType?: "one-way" | "round-trip" | "multi-city"
  returnDate?: string
  sort?: "price-asc" | "price-desc" | "duration-asc" | "duration-desc" | "airline" | "none"
  seat?: "economy" | "premium-economy" | "business" | "first"
  adults?: number
  children?: number
  infantsInSeat?: number
  infantsOnLap?: number
  maxPrice?: number
  minPrice?: number
  maxDuration?: number
  maxStops?: 0 | 1 | 2
  nonstopOnly?: boolean
  airlines?: string[]
  limit?: number | "all"
  currency?: string
  production?: boolean
  json?: boolean
}

/**
 * Parses command-line arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const parsed: CliArgs = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    switch (arg) {
      case "--from":
      case "-f":
        if (nextArg) parsed.from = nextArg
        i++
        break
      case "--to":
      case "-t":
        if (nextArg) parsed.to = nextArg
        i++
        break
      case "--depart-date":
      case "-d":
        if (nextArg) parsed.departDate = nextArg
        i++
        break
      case "--return-date":
      case "-r":
        if (nextArg) parsed.returnDate = nextArg
        i++
        break
      case "--trip-type":
        if (nextArg && ["one-way", "round-trip", "multi-city"].includes(nextArg)) {
          parsed.tripType = nextArg as TripType
        }
        i++
        break
      case "--sort":
      case "-s":
        if (nextArg && ["price-asc", "price-desc", "duration-asc", "duration-desc", "airline", "none"].includes(nextArg)) {
          parsed.sort = nextArg as SortOption
        }
        i++
        break
      case "--seat":
        if (nextArg && ["economy", "premium-economy", "business", "first"].includes(nextArg)) {
          parsed.seat = nextArg as SeatClass
        }
        i++
        break
      case "--adults":
      case "-a":
        if (nextArg) parsed.adults = parseInt(nextArg, 10)
        i++
        break
      case "--children":
      case "-c":
        if (nextArg) parsed.children = parseInt(nextArg, 10)
        i++
        break
      case "--infants-in-seat":
        if (nextArg) parsed.infantsInSeat = parseInt(nextArg, 10)
        i++
        break
      case "--infants-on-lap":
        if (nextArg) parsed.infantsOnLap = parseInt(nextArg, 10)
        i++
        break
      case "--max-price":
        if (nextArg) parsed.maxPrice = parseFloat(nextArg)
        i++
        break
      case "--min-price":
        if (nextArg) parsed.minPrice = parseFloat(nextArg)
        i++
        break
      case "--max-duration":
        if (nextArg) parsed.maxDuration = parseInt(nextArg, 10)
        i++
        break
      case "--max-stops":
        if (nextArg) parsed.maxStops = parseInt(nextArg, 10) as 0 | 1 | 2
        i++
        break
      case "--nonstop-only":
        parsed.nonstopOnly = true
        break
      case "--airlines":
        if (nextArg) parsed.airlines = nextArg.split(",").map(a => a.trim())
        i++
        break
      case "--limit":
      case "-l":
        if (nextArg) {
          if (nextArg === "all") {
            parsed.limit = "all"
          } else {
            const num = parseInt(nextArg, 10)
            if (!isNaN(num)) parsed.limit = num
          }
        }
        i++
        break
      case "--currency":
        if (nextArg) parsed.currency = nextArg
        i++
        break
      case "--production":
      case "-p":
        parsed.production = true
        break
      case "--json":
      case "-j":
        parsed.json = true
        break
      case "--help":
      case "-h":
        printHelp()
        process.exit(0)
    }
  }

  return parsed
}

/**
 * Prints help message
 */
function printHelp(): void {
  console.log(`
Google Flights Scraper - CLI

Usage:
  flights-scraper [options]

Required Options:
  --from, -f <code>              Origin airport code (e.g., JFK)
  --to, -t <code>                 Destination airport code (e.g., LHR)
  --depart-date, -d <date>        Departure date (YYYY-MM-DD)

Optional Options:
  --return-date, -r <date>        Return date for round-trip (YYYY-MM-DD)
  --trip-type <type>              Trip type: one-way, round-trip, multi-city (default: one-way)
  --sort, -s <option>             Sort: price-asc, price-desc, duration-asc, duration-desc, airline, none (default: price-asc)
  --seat <class>                  Seat class: economy, premium-economy, business, first (default: economy)
  --adults, -a <number>           Number of adults (default: 1)
  --children, -c <number>         Number of children (default: 0)
  --infants-in-seat <number>      Number of infants in seat (default: 0)
  --infants-on-lap <number>       Number of infants on lap (default: 0)
  --max-price <number>            Maximum price filter
  --min-price <number>            Minimum price filter
  --max-duration <minutes>        Maximum duration in minutes
  --max-stops <0|1|2>             Maximum number of stops (default: 2)
  --nonstop-only                  Only show nonstop flights
  --airlines <list>               Comma-separated list of airlines
  --limit, -l <number|all>        Limit number of results (default: 10)
  --currency <code>               Currency code (e.g., USD, EUR)
  --production, -p                Use production mode (caching, rate limiting, retry)
  --json, -j                      Output results as JSON
  --help, -h                      Show this help message

Examples:
  # One-way flight
  flights-scraper --from JFK --to LHR --depart-date 2025-12-25

  # Round-trip with filters
  flights-scraper --from LAX --to NRT --depart-date 2026-06-15 \\
    --return-date 2026-06-30 --trip-type round-trip \\
    --max-stops 1 --limit 20 --seat business

  # Production mode with JSON output
  flights-scraper --from AEP --to SCL --depart-date 2026-01-11 \\
    --production --json
`)
}

/**
 * Formats flight results for display
 */
function formatFlight(flight: any, index: number): string {
  const bestBadge = flight.is_best ? "⭐ " : ""
  const departureArrival = flight.departure && flight.arrival 
    ? `${flight.departure} → ${flight.arrival}` 
    : ""
  const timeAhead = flight.arrival_time_ahead ? ` (${flight.arrival_time_ahead})` : ""
  const stopsText = flight.stops === 0 ? "Nonstop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`
  const delay = flight.delay ? ` | Delay: ${flight.delay}` : ""
  
  return `${index + 1}. ${bestBadge}${flight.name}
   ${departureArrival}${timeAhead}
   ${flight.duration} | ${stopsText} | ${flight.price}${delay}`
}

/**
 * Main CLI program
 */
export const cliProgram = Effect.gen(function* () {
  const args = parseArgs()

  // Validate required arguments
  if (!args.from || !args.to || !args.departDate) {
    yield* Console.error("Error: --from, --to, and --depart-date are required")
    printHelp()
    return process.exit(1)
  }

  // Build search parameters
  const tripType: TripType = args.tripType || "one-way"
  const returnDate = args.returnDate
  const sortOption: SortOption = args.sort || "price-asc"
  const seat: SeatClass = args.seat || "economy"
  
  const passengers: Passengers = {
    adults: args.adults || 1,
    children: args.children || 0,
    infants_in_seat: args.infantsInSeat || 0,
    infants_on_lap: args.infantsOnLap || 0
  }

  const filters: FlightFilters = {
    maxPrice: args.maxPrice,
    minPrice: args.minPrice,
    maxDurationMinutes: args.maxDuration,
    max_stops: args.maxStops,
    nonstopOnly: args.nonstopOnly,
    airlines: args.airlines ? [...args.airlines] : undefined,
    limit: args.limit || 10
  }

  const currency = args.currency || ""

  // Log search parameters (unless JSON output)
  if (!args.json) {
    const tripDescription = returnDate ? ` (Return: ${returnDate})` : ` (${tripType})`
    yield* Console.log(`🕷️  Starting Flight Scraper: ${args.from} -> ${args.to} on ${args.departDate}${tripDescription}`)
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

    if (args.production) {
      yield* Console.log(`\n🚀 Production mode enabled (caching, rate limiting, retry)`)
    }
  }

  // Get scraper service
  const scraper = yield* ScraperService

  // Execute search
  const result = yield* scraper.scrape(
    args.from,
    args.to,
    args.departDate,
    tripType,
    returnDate,
    sortOption,
    filters,
    seat,
    passengers,
    currency
  )

  // Output results
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    if (result.flights.length === 0) {
      yield* Console.warn("❌ No flights found")
    } else {
      yield* Console.log(`\n✅ Found ${result.flights.length} flight options:`)
      
      if (result.current_price) {
        yield* Console.log(`💰 Price level: ${result.current_price.toUpperCase()}\n`)
      }
      
      result.flights.forEach((flight, i) => {
        console.log(formatFlight(flight, i))
        console.log("")
      })
    }
  }

  return result
})

/**
 * Creates the Layer for CLI execution
 */
export const createCliLayer = (production: boolean = false) => {
  if (production) {
    return ScraperProductionLive.pipe(
      Layer.provide(CacheLive(defaultCacheConfig)),
      Layer.provide(RateLimiterLive(defaultRateLimiterConfig)),
      Layer.provide(FetchHttpClient.layer)
    )
  } else {
    return ScraperProtobufLive.pipe(
      Layer.provide(FetchHttpClient.layer)
    )
  }
}

/**
 * Runs the CLI program
 */
export const runCli = (production: boolean = false) => {
  const program = cliProgram.pipe(
    Effect.provide(createCliLayer(production)),
    Effect.match({
      onFailure: (error) => {
        console.error("\n--- ERROR ---")
        console.error(error)
        process.exit(1)
      },
      onSuccess: (result) => {
        if (!process.argv.includes("--json") && !process.argv.includes("-j")) {
          console.log("\n--- COMPLETE ---")
        }
        process.exit(0)
      }
    })
  )

  return Effect.runPromise(program)
}
