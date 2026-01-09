/**
 * Google Flights scraper using Protocol Buffers (HTTP-based, no browser)
 * Inspired by: https://github.com/AWeirdDev/flights
 */

import { Effect, Layer, Console } from "effect"
import { FlightOption, ScraperError, Result, SortOption, FlightFilters, TripType, SeatClass, Passengers } from "../domain"
import { ScraperService } from "./scraper"
import { encodeFlightSearch, FlightData as ProtobufFlightData } from "../utils/protobuf"
import * as cheerio from "cheerio"

/**
 * Fetches the Google Flights HTML via HTTP (no browser needed!)
 */
const fetchFlightsHtml = (url: string): Effect.Effect<string, ScraperError> =>
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
    catch: (e) => new ScraperError({ reason: "NavigationFailed", message: String(e) })
  })

/**
 * Extracts JavaScript data from Google Flights HTML
 * Google embeds flight data in a script tag that we can parse directly
 */
const extractJavaScriptData = (html: string): Effect.Effect<Result, ScraperError> =>
  Effect.try({
    try: () => {
      const $ = cheerio.load(html)

      // Find the script tag containing flight data (script.ds\:1)
      const scripts = $('script')
      let flightData: any = null

      scripts.each((_, el) => {
        const scriptContent = $(el).html() || ""
        // Look for the data array pattern from Python: data:(\[.*\])
        const match = scriptContent.match(/data:(\[.*?\](?:\s*,\s*\{[^}]*\})*)/s)
        if (match) {
          try {
            // Extract just the array part
            const dataStr = match[1].replace(/\n/g, ' ').trim()
            flightData = JSON.parse(dataStr)
            return false // break the loop
          } catch (e) {
            // Continue searching
          }
        }
      })

      // Always use HTML fallback for more reliable parsing
      // The JavaScript data structure is too complex and unreliable
      return parseHtmlFallback(html)

      const flights: FlightOption[] = []

      // Parse the nested data structure
      // Based on decoder.py structure: [2][0] for best flights, [3][0] for other flights
      const bestFlights = flightData[2]?.[0] || []
      const otherFlights = flightData[3]?.[0] || []

      const parseFlightItinerary = (itinerary: any, is_best: boolean) => {
        if (!itinerary || !Array.isArray(itinerary[0])) return

        const info = itinerary[0]

        // Extract airline name - typically first short string in info[1]
        let airlineName = "Unknown"
        const airlineData = info[1]
        if (airlineData) {
          if (typeof airlineData === 'string') {
            airlineName = airlineData
          } else if (Array.isArray(airlineData) && airlineData.length > 0) {
            // Get only short strings that look like airline names (< 30 chars, no special markers)
            const validNames = airlineData
              .filter((item: any) =>
                typeof item === 'string' &&
                item.length > 0 &&
                item.length < 30 &&
                !item.includes('Airport') &&
                !item.includes('CO2') &&
                !item.includes('stop') &&
                !item.includes('min') &&
                !item.includes('hr')
              )
            if (validNames.length > 0) {
              // Take only first 3 airline names max
              airlineName = validNames.slice(0, 3).join(", ")
            } else if (typeof airlineData[0] === 'string') {
              // Fallback to first item
              airlineName = airlineData[0]
            }
          }
        }

        const departureTime = info[5] ? `${info[5][0]}:${String(info[5][1]).padStart(2, '0')}` : ""
        const arrivalTime = info[8] ? `${info[8][0]}:${String(info[8][1]).padStart(2, '0')}` : ""
        const travelTime = info[9] || 0
        const hours = Math.floor(travelTime / 60)
        const minutes = travelTime % 60
        const duration = `${hours} hr ${minutes} min`
        const layovers = info[13] || []
        const stops = layovers.length

        // Price extraction from itinerary summary
        const price = "N/A" // Will be extracted from HTML as fallback

        flights.push(new FlightOption({
          is_best,
          name: airlineName,
          departure: departureTime,
          arrival: arrivalTime,
          arrival_time_ahead: undefined,
          duration,
          stops,
          delay: undefined,
          price,
          deep_link: undefined // Not available from JS data, only from HTML
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
    catch: (e) => new ScraperError({ reason: "ParsingError", message: String(e) })
  })

/**
 * HTML parser based on reference implementation from fast_flights
 */
const parseHtmlFallback = (html: string): Result => {
  const $ = cheerio.load(html)
  const flights: FlightOption[] = []

  // Find flight containers (best flights + other flights)
  const flightContainers = $('div[jsname="IWWDBc"], div[jsname="YdtKid"]')

  flightContainers.each((containerIndex, container) => {
    const isBestSection = containerIndex === 0

    // Each flight item is in ul.Rk10dc li
    $(container).find('ul.Rk10dc li').each((itemIndex, item) => {
      const $item = $(item)

      // Flight name - specific selector with span inside
      const name = $item.find('div.sSHqwe.tPgKwe.ogfYpf span').first().text().trim() || "Unknown"

      // Departure & arrival time - get first two divs inside mv1WYe spans
      const timeNodes = $item.find('span.mv1WYe div')
      const departure = timeNodes.length > 0 ? $(timeNodes[0]).text().trim().replace(/\s+/g, ' ') : ""
      const arrival = timeNodes.length > 1 ? $(timeNodes[1]).text().trim().replace(/\s+/g, ' ') : ""

      // Arrival time ahead (e.g., "+1") - only get first match
      const arrivalTimeAhead = $item.find('span.bOzv6').first().text().trim() || undefined

      // Duration - be more specific with selector
      const durationEl = $item.find('div.gvkrdb, li div.Ak5kof div').first()
      const duration = durationEl.text().trim() || "N/A"

      // Stops - only get first match
      const stopsEl = $item.find('.BbR8Ec .ogfYpf').first()
      const stopsText = stopsEl.text().trim()
      let stops = 0
      if (stopsText && stopsText !== "Nonstop") {
        const match = stopsText.match(/^(\d+)/)
        if (match) stops = parseInt(match[1])
      }

      // Delay - only first match
      const delay = $item.find('.GsCCve').first().text().trim() || undefined

      // Price - only get first price element and normalize
      const priceEl = $item.find('.YMlIz.FpEdX span').first()
      const priceText = priceEl.length ? priceEl.text().trim() : $item.find('.YMlIz.FpEdX').first().text().trim()
      const priceMatch = priceText.match(/\$?\s*([\d,]+)/)
      const numeric = priceMatch ? priceMatch[1].replace(/,/g, '') : undefined
      const price = numeric ? `$${numeric}` : "N/A"

      // Deep link - try to extract booking URL from the flight card
      // Google Flights booking URLs look like: /travel/flights/booking?tfs=...&tfu=...&curr=...
      let deep_link: string | undefined = undefined

      // Look for booking links specifically (href containing /travel/flights/booking or tfs=)
      const bookingLink = $item.find('a[href*="/travel/flights/booking"], a[href*="tfs="]').first()
      if (bookingLink.length) {
        const href = bookingLink.attr('href')
        if (href) {
          deep_link = href.startsWith('http') ? href : `https://www.google.com${href}`
        }
      }

      // Try to find links with booking-related data attributes
      if (!deep_link) {
        const linkEl = $item.find('a[data-tfs], a[data-url*="booking"]').first()
        if (linkEl.length) {
          const dataTfs = linkEl.attr('data-tfs')
          if (dataTfs) {
            deep_link = `https://www.google.com/travel/flights/booking?tfs=${encodeURIComponent(dataTfs)}&curr=USD`
          } else {
            const dataUrl = linkEl.attr('data-url')
            if (dataUrl) {
              deep_link = dataUrl.startsWith('http') ? dataUrl : `https://www.google.com${dataUrl}`
            }
          }
        }
      }

      // Try the parent li element for booking URL data
      if (!deep_link) {
        // Look for any element with jsdata or jsaction that might contain booking info
        const jsDataEl = $item.find('[jsdata*="tfs"], [data-flt-ve]').first()
        if (jsDataEl.length) {
          const jsdata = jsDataEl.attr('jsdata') || ''
          const tfsMatch = jsdata.match(/tfs=([^&\s;]+)/)
          if (tfsMatch) {
            deep_link = `https://www.google.com/travel/flights/booking?tfs=${tfsMatch[1]}&curr=USD`
          }
        }
      }

      // Last resort: try to extract from onclick or jsaction attributes
      if (!deep_link) {
        const clickableEl = $item.find('[onclick*="booking"], [jsaction*="select"]').first()
        const onclick = clickableEl.attr('onclick') || clickableEl.attr('jsaction') || ''
        const urlMatch = onclick.match(/\/travel\/flights\/booking\?[^'"]+/)
        if (urlMatch) {
          deep_link = `https://www.google.com${urlMatch[0]}`
        }
      }

      if (name !== "Unknown") {
        flights.push(new FlightOption({
          is_best: isBestSection && itemIndex === 0,
          name,
          departure,
          arrival,
          arrival_time_ahead: arrivalTimeAhead,
          duration,
          stops,
          delay,
          price,
          deep_link
        }))
      }
    })
  })

  // Price indicator
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
 * Sorts flights based on the specified option
 */
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
      case "duration-asc": {
        return parseDurationToMinutes(a.duration) - parseDurationToMinutes(b.duration)
      }
      case "duration-desc": {
        return parseDurationToMinutes(b.duration) - parseDurationToMinutes(a.duration)
      }
      case "airline": {
        return a.name.localeCompare(b.name)
      }
      default:
        return 0
    }
  })
}

/**
 * Parses duration string to minutes
 */
const parseDurationToMinutes = (duration: string): number => {
  const hourMatch = duration.match(/(\d+)\s*hr/)
  const minMatch = duration.match(/(\d+)\s*min/)
  const hours = hourMatch ? parseInt(hourMatch[1]) : 0
  const minutes = minMatch ? parseInt(minMatch[1]) : 0
  return hours * 60 + minutes
}

/**
 * Filters flights based on criteria
 */
const filterFlights = (flights: readonly FlightOption[], filters: FlightFilters): FlightOption[] => {
  return flights.filter(flight => {
    const price = parseFloat(flight.price.replace(/[^0-9.-]/g, "")) || 0
    const durationMinutes = parseDurationToMinutes(flight.duration)

    // Price filters
    if (filters.maxPrice !== undefined && price > filters.maxPrice) return false
    if (filters.minPrice !== undefined && price < filters.minPrice) return false

    // Duration filter
    if (filters.maxDurationMinutes !== undefined && durationMinutes > filters.maxDurationMinutes) return false

    // Airline filter
    if (filters.airlines && filters.airlines.length > 0) {
      const matchesAirline = filters.airlines.some(airline =>
        flight.name.toLowerCase().includes(airline.toLowerCase())
      )
      if (!matchesAirline) return false
    }

    // Nonstop filter
    if (filters.nonstopOnly && flight.stops !== 0) return false

    // Max stops filter
    if (filters.max_stops !== undefined && flight.stops > filters.max_stops) return false

    return true
  })
}

/**
 * Creates the ScraperService implementation using Protobuf encoding
 */
export const ScraperProtobufLive = Layer.effect(
  ScraperService,
  Effect.gen(function* () {
    return ScraperService.of({
      scrape: (from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency) =>
        Effect.gen(function* () {
          // Validate input (using yieldable error pattern)
          if (tripType === "round-trip" && !returnDate) {
            return yield* new ScraperError({ reason: "InvalidInput", message: "Return date is required for round-trip flights." })
          }

          // Default values
          const seatClass: SeatClass = seat || "economy"
          const passengerCounts: Passengers = passengers || { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }
          const curr = currency || ""

          // Build flight data
          const flightData: ProtobufFlightData[] = [
            {
              date: departDate,
              from_airport: from,
              to_airport: to,
              max_stops: filters.max_stops,
              airlines: filters.airlines
            }
          ]

          // Add return flight for round-trip
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

          // Fetch HTML
          const html = yield* fetchFlightsHtml(url)
          yield* Console.log(`📄 Received ${html.length} bytes of HTML`)

          // Parse HTML (try JavaScript data first, fallback to HTML)
          const result = yield* extractJavaScriptData(html)
          yield* Console.log(`✈️  Extracted ${result.flights.length} raw flight entries`)

          if (result.current_price) {
            yield* Console.log(`💰 Price indicator: ${result.current_price}`)
          }

          // Apply filters
          const filteredFlights = filterFlights(result.flights, filters)

          // Apply sorting
          const sortedFlights = sortFlights(filteredFlights, sortOption)

          // Apply limit
          if (typeof filters.limit === "number") {
            return new Result({ current_price: result.current_price, flights: sortedFlights.slice(0, filters.limit) })
          }

          // "all" limit is not applicable in HTTP-only approach
          return new Result({ current_price: result.current_price, flights: sortedFlights })
        })
    })
  })
)
