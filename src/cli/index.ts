/**
 * CLI interface for Google Flights Scraper
 * Accepts command-line arguments and returns flight search results
 */

import { Effect, Console, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeRuntime } from "@effect/platform-node"
import { ScraperService, ScraperProtobufLive, ScraperProductionLive } from "../services"
import { RateLimiterLive, defaultRateLimiterConfig } from "../utils"
import { AirportCodeSchema, DateStringSchema, TripTypeSchema, SeatClassSchema, SortOptionSchema, PassengersSchema, FlightFiltersSchema } from "../domain"
import type { ScrapeRequest, FlightFilters, FlightOption } from "../domain"

/**
 * CLI Arguments interface. Values are kept as raw strings/numbers here;
 * `cliProgram` below decodes and validates them against the domain schemas.
 */
interface CliArgs {
  from?: string
  to?: string
  departDate?: string
  tripType?: string
  returnDate?: string
  sort?: string
  seat?: string
  adults?: number
  children?: number
  infantsInSeat?: number
  infantsOnLap?: number
  maxPrice?: number
  minPrice?: number
  maxDuration?: number
  maxStops?: number
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
        if (nextArg) parsed.tripType = nextArg
        i++
        break
      case "--sort":
      case "-s":
        if (nextArg) parsed.sort = nextArg
        i++
        break
      case "--seat":
        if (nextArg) parsed.seat = nextArg
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
        if (nextArg) parsed.maxStops = parseInt(nextArg, 10)
        i++
        break
      case "--nonstop-only":
        parsed.nonstopOnly = true
        break
      case "--airlines":
        if (nextArg) parsed.airlines = nextArg.split(",").map((a) => a.trim())
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
function formatFlight(flight: FlightOption, index: number): string {
  const bestBadge = flight.is_best ? "⭐ " : ""
  const departureArrival = flight.departure && flight.arrival ? `${flight.departure} → ${flight.arrival}` : ""
  const timeAhead = flight.arrival_time_ahead ? ` (${flight.arrival_time_ahead})` : ""
  const stopsText = flight.stops === 0 ? "Nonstop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`
  const delay = flight.delay ? ` | Delay: ${flight.delay}` : ""

  return `${index + 1}. ${bestBadge}${flight.name}
   ${departureArrival}${timeAhead}
   ${flight.duration} | ${stopsText} | ${flight.price}${delay}`
}

/**
 * Decodes a raw CLI value against a domain schema, exiting with a helpful
 * error message if it fails validation. Keeps enum/range rules defined once,
 * in the domain schemas, instead of duplicated as ad-hoc checks here.
 * Exiting on a malformed flag is acceptable in this startup path.
 */
function decodeOrExit<A>(schema: Schema.ConstraintDecoder<A>, value: unknown, label: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    console.error(`Error: invalid ${label}`)
    console.error(error instanceof Error ? error.message : String(error))
    return process.exit(1)
  }
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

  // Build the search request, decoding each raw value against its domain schema
  const from = decodeOrExit(AirportCodeSchema, args.from.toUpperCase(), "--from")
  const to = decodeOrExit(AirportCodeSchema, args.to.toUpperCase(), "--to")
  const departDate = decodeOrExit(DateStringSchema, args.departDate, "--depart-date")
  const returnDate = args.returnDate === undefined ? undefined : decodeOrExit(DateStringSchema, args.returnDate, "--return-date")
  const tripType = args.tripType === undefined ? ("one-way" as const) : decodeOrExit(TripTypeSchema, args.tripType, "--trip-type")
  const sortOption = args.sort === undefined ? ("price-asc" as const) : decodeOrExit(SortOptionSchema, args.sort, "--sort")
  const seat = args.seat === undefined ? ("economy" as const) : decodeOrExit(SeatClassSchema, args.seat, "--seat")

  const passengers = decodeOrExit(
    PassengersSchema,
    {
      adults: args.adults ?? 1,
      children: args.children ?? 0,
      infants_in_seat: args.infantsInSeat ?? 0,
      infants_on_lap: args.infantsOnLap ?? 0,
    },
    "passenger counts",
  )

  // Filters use optional keys: only include the flags that were actually set
  const filters: FlightFilters = decodeOrExit(
    FlightFiltersSchema,
    {
      ...(args.maxPrice !== undefined && { maxPrice: args.maxPrice }),
      ...(args.minPrice !== undefined && { minPrice: args.minPrice }),
      ...(args.maxDuration !== undefined && { maxDurationMinutes: args.maxDuration }),
      ...(args.maxStops !== undefined && { max_stops: args.maxStops }),
      ...(args.nonstopOnly !== undefined && { nonstopOnly: args.nonstopOnly }),
      ...(args.airlines !== undefined && { airlines: [...args.airlines] }),
      limit: args.limit ?? 10,
    },
    "filters",
  )

  const request: ScrapeRequest = {
    from,
    to,
    departDate,
    tripType,
    ...(returnDate !== undefined && { returnDate }),
    sortOption,
    filters,
    seat,
    passengers,
    ...(args.currency !== undefined && { currency: args.currency }),
  }

  // Log search parameters (unless JSON output)
  if (!args.json) {
    const tripDescription = returnDate ? ` (Return: ${returnDate})` : ` (${tripType})`
    yield* Console.log(`🕷️  Starting Flight Scraper: ${from} -> ${to} on ${departDate}${tripDescription}`)
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

  const scraper = yield* ScraperService
  const result = yield* scraper.scrape(request)

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

    yield* Console.log("\n--- COMPLETE ---")
  }

  return result
})

/**
 * Creates the Layer for CLI execution
 */
export const createCliLayer = (production: boolean = false) => {
  if (production) {
    return ScraperProductionLive.pipe(Layer.provide(RateLimiterLive(defaultRateLimiterConfig)), Layer.provide(FetchHttpClient.layer))
  } else {
    return ScraperProtobufLive.pipe(Layer.provide(FetchHttpClient.layer))
  }
}

/**
 * Runs the CLI program via the platform runtime, which handles interrupts,
 * finalizers, and process exit codes.
 */
export const runCli = (production: boolean = false): void => {
  const program = cliProgram.pipe(
    Effect.provide(createCliLayer(production)),
    Effect.tapError((error) => Console.error(`\n--- ERROR ---\n${error.message}`)),
  )

  NodeRuntime.runMain(program, { disableErrorReporting: true })
}
