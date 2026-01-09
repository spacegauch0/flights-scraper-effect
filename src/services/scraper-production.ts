/**
 * Production-ready scraper with caching, rate limiting, and retry logic
 */

import { Effect, Layer, Console } from "effect"
import { ScraperService } from "./scraper"
import { FlightOption, ScraperError, ScraperErrors, Result, SortOption, FlightFilters, TripType, SeatClass, Passengers } from "../domain"
import { encodeFlightSearch, FlightData as ProtobufFlightData } from "../utils/protobuf"
import { CacheService, createCacheKey } from "../utils/cache"
import { RateLimiterService } from "../utils/rate-limiter"
import { withRetryAndLog } from "../utils/retry"
import * as cheerio from "cheerio"

/**
 * Fetches the Google Flights HTML via HTTP with retry logic
 */
const fetchFlightsHtml = (url: string): Effect.Effect<string, ScraperError, RateLimiterService> =>
  Effect.gen(function* () {
    // Acquire rate limit token
    const rateLimiter = yield* RateLimiterService
    yield* rateLimiter.acquire()

    // Fetch with retry
    return yield* withRetryAndLog(
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(url, {
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
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          return await response.text()
        },
        catch: (e) => ScraperErrors.navigationFailed(url, String(e))
      }),
      "Fetch Google Flights HTML"
    )
  })

/**
 * Extracts JavaScript data from Google Flights HTML
 */
const extractJavaScriptData = (html: string): Effect.Effect<Result, ScraperError> =>
  Effect.try({
    try: () => {
      const $ = cheerio.load(html)
      
      // Find the script tag containing flight data
      const scripts = $('script')
      let flightData: any = null
      
      scripts.each((_, el) => {
        const scriptContent = $(el).html() || ""
        // Look for the data array pattern
        const match = scriptContent.match(/data:(\[.*?\](?:\s*,\s*\{[^}]*\})*)/s)
        if (match) {
          try {
            const dataStr = match[1].replace(/\n/g, ' ').trim()
            flightData = JSON.parse(dataStr)
            return false // break
          } catch (e) {
            // Continue searching
          }
        }
      })

      if (!flightData || !Array.isArray(flightData)) {
        return parseHtmlFallback(html)
      }

      const flights: FlightOption[] = []
      
      // Parse the nested data structure
      const bestFlights = flightData[2]?.[0] || []
      const otherFlights = flightData[3]?.[0] || []
      
      const parseFlightItinerary = (itinerary: any, is_best: boolean) => {
        if (!itinerary || !Array.isArray(itinerary[0])) return
        
        const info = itinerary[0]
        const airlineName = info[1]?.[0] || "Unknown"
        const departureTime = info[5] ? `${info[5][0]}:${String(info[5][1]).padStart(2, '0')}` : ""
        const arrivalTime = info[8] ? `${info[8][0]}:${String(info[8][1]).padStart(2, '0')}` : ""
        const travelTime = info[9] || 0
        const hours = Math.floor(travelTime / 60)
        const minutes = travelTime % 60
        const duration = `${hours} hr ${minutes} min`
        const layovers = info[13] || []
        const stops = layovers.length
        
        // Price extraction
        const price = "N/A"
        
        flights.push(new FlightOption({
          is_best,
          name: airlineName,
          departure: departureTime,
          arrival: arrivalTime,
          arrival_time_ahead: undefined,
          duration,
          stops,
          delay: undefined,
          price
        }))
      }
      
      bestFlights.forEach((itinerary: any) => parseFlightItinerary(itinerary, true))
      otherFlights.forEach((itinerary: any) => parseFlightItinerary(itinerary, false))
      
      // Extract price indicator
      const priceIndicatorText = $("span.gOatQ").text().trim().toLowerCase()
      let current_price: "low" | "typical" | "high" | undefined = undefined
      if (priceIndicatorText.includes("low")) current_price = "low"
      else if (priceIndicatorText.includes("typical")) current_price = "typical"
      else if (priceIndicatorText.includes("high")) current_price = "high"
      
      return new Result({
        current_price,
        flights
      })
    },
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
        price
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
 */
export const ScraperProductionLive = Layer.effect(
  ScraperService,
  Effect.gen(function* () {
    const cache = yield* CacheService
    const rateLimiter = yield* RateLimiterService

    return ScraperService.of({
      scrape: (from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency) =>
        Effect.gen(function* () {
          // Validate input (using yieldable error pattern)
          if (tripType === "round-trip" && !returnDate) {
            return yield* ScraperErrors.invalidInput("returnDate", "Return date is required for round-trip flights")
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

          // Fetch HTML (with rate limiting and retry)
          const html = yield* fetchFlightsHtml(url).pipe(Effect.provide(Layer.succeed(RateLimiterService, rateLimiter)))
          yield* Console.log(`📄 Received ${html.length} bytes of HTML`)

          // Parse HTML
          const result = yield* extractJavaScriptData(html)
          yield* Console.log(`✈️  Extracted ${result.flights.length} raw flight entries`)

          if (result.current_price) {
            yield* Console.log(`💰 Price indicator: ${result.current_price}`)
          }

          // Cache the raw results
          yield* cache.set(cacheKey, result)

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

