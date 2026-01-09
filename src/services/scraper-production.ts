/**
 * Production-ready scraper with caching, rate limiting, and retry logic
 */

import { Effect, Layer, Console } from "effect"
import { HttpClient } from "@effect/platform"
import { ScraperService } from "./scraper"
import { FlightOption, ScraperError, ScraperErrors, Result, SortOption, FlightFilters, TripType, SeatClass, Passengers } from "../domain"
import { encodeFlightSearch, FlightData as ProtobufFlightData } from "../utils/protobuf"
import { CacheService, createCacheKey } from "../utils/cache"
import { RateLimiterService } from "../utils/rate-limiter"
import { withRetryAndLog } from "../utils/retry"
import * as cheerio from "cheerio"

/**
 * Fetches the Google Flights HTML via HTTP with retry logic using Effect Platform HttpClient
 * Requires RateLimiterService and HttpClient in context
 */
const fetchFlightsHtml = (url: string): Effect.Effect<string, ScraperError, RateLimiterService | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    // Acquire rate limit token
    const rateLimiter = yield* RateLimiterService
    yield* rateLimiter.acquire()

    // Fetch with retry using Effect Platform HttpClient
    return yield* withRetryAndLog(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient
        
        const response = yield* client.get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Cache-Control": "max-age=0"
          }
        }).pipe(
          Effect.mapError((error) => ScraperErrors.navigationFailed(url, String(error)))
        )

        const body = yield* response.text.pipe(
          Effect.mapError((error) => ScraperErrors.navigationFailed(url, `Failed to read response: ${String(error)}`))
        )

        return body
      }),
      "Fetch Google Flights HTML"
    )
  })

/**
 * Extracts flight data from Google Flights HTML
 * Uses HTML parsing as the primary method (more reliable than JavaScript data extraction)
 */
const extractJavaScriptData = (html: string): Effect.Effect<Result, ScraperError> =>
  Effect.try({
    try: () => parseHtmlFallback(html),
    catch: (e) => ScraperErrors.parsingError(String(e))
  })

/**
 * Fallback HTML parser
 */
const parseHtmlFallback = (html: string): Result => {
  const $ = cheerio.load(html)
  const flights: FlightOption[] = []
  const cards = $('li.pIav2d')
  
  cards.each((index, element) => {
    const card = $(element)
    const text = card.text()

    const priceMatch = text.match(/(?:ARS|USD|EUR|GBP|\$)\s*[\u00A0\s]*(\d{1,3}(?:[,\s]\d{3})*|\d+)/)
    const price = priceMatch ? priceMatch[0] : "N/A"

    let airline = "Unknown"
    const airlineElements = card.find('.sSHqwe')
    for (let i = 0; i < airlineElements.length; i++) {
      const currentAirlineText = $(airlineElements[i]).text().trim()
      if (currentAirlineText && !currentAirlineText.includes("kg CO2") && !currentAirlineText.includes("Aged")) {
        airline = currentAirlineText
        break
      }
    }

    const duration = card.find('.gvkrdb').text().trim() || "N/A"
    const nonstop = text.includes("Nonstop")
    const stops = nonstop ? 0 : 1

    // Deep link - try to extract booking URL from the flight card
    // Google Flights booking URLs look like: /travel/flights/booking?tfs=...&tfu=...&curr=...
    let deep_link: string | undefined = undefined
    
    // Look for booking links specifically
    const bookingLink = card.find('a[href*="/travel/flights/booking"], a[href*="tfs="]').first()
    if (bookingLink.length) {
      const href = bookingLink.attr('href')
      if (href) {
        deep_link = href.startsWith('http') ? href : `https://www.google.com${href}`
      }
    }
    
    // Try data attributes
    if (!deep_link) {
      const linkEl = card.find('a[data-tfs], a[data-url*="booking"]').first()
      if (linkEl.length) {
        const dataTfs = linkEl.attr('data-tfs')
        if (dataTfs) {
          deep_link = `https://www.google.com/travel/flights/booking?tfs=${encodeURIComponent(dataTfs)}&curr=USD`
        }
      }
    }
    
    // Try jsdata attributes for tfs parameter
    if (!deep_link) {
      const jsDataEl = card.find('[jsdata*="tfs"]').first()
      if (jsDataEl.length) {
        const jsdata = jsDataEl.attr('jsdata') || ''
        const tfsMatch = jsdata.match(/tfs=([^&\s;]+)/)
        if (tfsMatch) {
          deep_link = `https://www.google.com/travel/flights/booking?tfs=${tfsMatch[1]}&curr=USD`
        }
      }
    }

    if (airline !== "Unknown") {
      flights.push(new FlightOption({
        is_best: index === 0,
        name: airline,
        departure: "",
        arrival: "",
        arrival_time_ahead: undefined,
        duration,
        stops,
        delay: undefined,
        price,
        deep_link
      }))
    }
  })

  const priceIndicatorText = $("span.gOatQ").text().trim().toLowerCase()
  let current_price: "low" | "typical" | "high" | undefined = undefined
  if (priceIndicatorText.includes("low")) current_price = "low"
  else if (priceIndicatorText.includes("typical")) current_price = "typical"
  else if (priceIndicatorText.includes("high")) current_price = "high"

  return new Result({
    current_price,
    flights
  })
}

/**
 * Sorting and filtering functions
 */
const parseDurationToMinutes = (duration: string): number => {
  const hourMatch = duration.match(/(\d+)\s*hr/)
  const minMatch = duration.match(/(\d+)\s*min/)
  const hours = hourMatch ? parseInt(hourMatch[1]) : 0
  const minutes = minMatch ? parseInt(minMatch[1]) : 0
  return hours * 60 + minutes
}

const sortFlights = (flights: readonly FlightOption[], sortOption: SortOption): FlightOption[] => {
  if (sortOption === "none") return [...flights]

  return [...flights].sort((a, b) => {
    switch (sortOption) {
      case "price-asc": {
        const priceA = parseFloat(a.price.replace(/[^0-9.-]/g, "")) || 0
        const priceB = parseFloat(b.price.replace(/[^0-9.-]/g, "")) || 0
        return priceA - priceB
      }
      case "price-desc": {
        const priceA = parseFloat(a.price.replace(/[^0-9.-]/g, "")) || 0
        const priceB = parseFloat(b.price.replace(/[^0-9.-]/g, "")) || 0
        return priceB - priceA
      }
      case "duration-asc":
        return parseDurationToMinutes(a.duration) - parseDurationToMinutes(b.duration)
      case "duration-desc":
        return parseDurationToMinutes(b.duration) - parseDurationToMinutes(a.duration)
      case "airline":
        return a.name.localeCompare(b.name)
      default:
        return 0
    }
  })
}

const filterFlights = (flights: readonly FlightOption[], filters: FlightFilters): FlightOption[] => {
  return flights.filter(flight => {
    const price = parseFloat(flight.price.replace(/[^0-9.-]/g, "")) || 0
    const durationMinutes = parseDurationToMinutes(flight.duration)

    if (filters.maxPrice !== undefined && price > filters.maxPrice) return false
    if (filters.minPrice !== undefined && price < filters.minPrice) return false
    if (filters.maxDurationMinutes !== undefined && durationMinutes > filters.maxDurationMinutes) return false
    
    if (filters.airlines && filters.airlines.length > 0) {
      const matchesAirline = filters.airlines.some(airline =>
        flight.name.toLowerCase().includes(airline.toLowerCase())
      )
      if (!matchesAirline) return false
    }

    if (filters.nonstopOnly && flight.stops !== 0) return false
    if (filters.max_stops !== undefined && flight.stops > filters.max_stops) return false

    return true
  })
}

/**
 * Production-ready scraper implementation with caching, rate limiting, and retry
 * Requires CacheService, RateLimiterService, and HttpClient to be provided via Layer
 */
export const ScraperProductionLive: Layer.Layer<ScraperService, never, CacheService | RateLimiterService | HttpClient.HttpClient> = Layer.effect(
  ScraperService,
  Effect.gen(function* () {
    const cache = yield* CacheService
    const rateLimiter = yield* RateLimiterService
    const httpClient = yield* HttpClient.HttpClient

    return ScraperService.of({
      scrape: (from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency) =>
        Effect.gen(function* () {
          // Validate input
          if (tripType === "round-trip" && !returnDate) {
            return yield* Effect.fail(ScraperErrors.invalidInput("returnDate", "Return date is required for round-trip flights"))
          }

          // Defaults
          const seatClass: SeatClass = seat || "economy"
          const passengerCounts: Passengers = passengers || { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }
          const curr = currency || ""

          // Check cache
          const cacheKey = createCacheKey(
            from, to, departDate, tripType, returnDate,
            seatClass,
            passengerCounts.adults,
            passengerCounts.children,
            passengerCounts.infants_in_seat,
            passengerCounts.infants_on_lap
          )

          const cached = yield* cache.get(cacheKey)
          if (cached) {
            yield* Console.log("📦 Cache hit! Using cached results")
            
            // Still apply client-side filtering and sorting
            const filteredFlights = filterFlights(cached.flights, filters)
            const sortedFlights = sortFlights(filteredFlights, sortOption)
            const limitedFlights = typeof filters.limit === "number" 
              ? sortedFlights.slice(0, filters.limit) 
              : sortedFlights

            return new Result({ current_price: cached.current_price, flights: limitedFlights })
          }
          
          yield* Console.log("🔍 Cache miss, fetching from Google Flights")

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

          // Encode to tfs parameter
          const tfs = yield* encodeFlightSearch(flightData, tripType, seatClass, passengerCounts)
          
          // Build URL
          const params = new URLSearchParams({ tfs, hl: "en", tfu: "EgQIABABIgA" })
          if (curr) params.set("curr", curr)
          const url = `https://www.google.com/travel/flights?${params.toString()}`

          yield* Console.log(`🚀 Fetching flights via HTTP: ${url.substring(0, 100)}...`)

          // Fetch HTML - provide RateLimiterService and HttpClient from Layer context
          const html = yield* fetchFlightsHtml(url).pipe(
            Effect.provide(Layer.succeed(RateLimiterService, rateLimiter)),
            Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
            Effect.tap((html) => Console.log(`📄 Received ${html.length} bytes of HTML`))
          )

          // Parse HTML
          const result = yield* extractJavaScriptData(html).pipe(
            Effect.tap((r) => Console.log(`✈️  Extracted ${r.flights.length} raw flight entries`))
          )

          if (result.current_price) {
            yield* Console.log(`💰 Price indicator: ${result.current_price}`)
          }

          // Cache the raw results
          yield* cache.set(cacheKey, result).pipe(
            Effect.tap(() => Console.log("💾 Cached search results"))
          )

          // Apply filters and sorting
          const filteredFlights = filterFlights(result.flights, filters)
          const sortedFlights = sortFlights(filteredFlights, sortOption)
          const limitedFlights = typeof filters.limit === "number"
            ? sortedFlights.slice(0, filters.limit)
            : sortedFlights

          return new Result({ current_price: result.current_price, flights: limitedFlights })
        })
    })
  })
)

