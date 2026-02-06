/**
 * Shared HTML parsing, sorting, and filtering logic for flight scrapers.
 * Extracted from scraper-protobuf.ts and scraper-production.ts to eliminate duplication.
 */

import { Effect } from "effect"
import { FlightOption, ScraperError, ScraperErrors, Result, SortOption, FlightFilters } from "../domain"
import * as cheerio from "cheerio"

/**
 * Extracts flight data from Google Flights HTML.
 * Wraps parseFlightsHtml in an Effect with proper error mapping.
 */
export const extractFlightsFromHtml = (html: string): Effect.Effect<Result, ScraperError> =>
  Effect.try({
    try: () => parseFlightsHtml(html),
    catch: (e) => new ScraperError({ reason: "ParsingError", message: `Failed to parse HTML: ${String(e)}` })
  })

/**
 * Pure HTML parser for Google Flights response.
 * Based on reference implementation from fast_flights (Python).
 */
export const parseFlightsHtml = (html: string): Result => {
  const $ = cheerio.load(html)
  const flights: FlightOption[] = []

  // Find flight containers: div[jsname="IWWDBc"] (best), div[jsname="YdtKid"] (other)
  const flightContainers = $('div[jsname="IWWDBc"], div[jsname="YdtKid"]')

  flightContainers.each((containerIndex, container) => {
    const isBestSection = containerIndex === 0

    // Each flight item is in ul.Rk10dc li
    $(container).find('ul.Rk10dc li').each((itemIndex, item) => {
      const $item = $(item)

      // Airline name
      const name = $item.find('div.sSHqwe.tPgKwe.ogfYpf span').first().text().trim() || "Unknown"

      // Departure & arrival time
      const timeNodes = $item.find('span.mv1WYe div')
      const departure = timeNodes.length > 0 ? $(timeNodes[0]).text().trim().replace(/\s+/g, ' ') : ""
      const arrival = timeNodes.length > 1 ? $(timeNodes[1]).text().trim().replace(/\s+/g, ' ') : ""

      // Arrival time ahead (e.g., "+1")
      const arrivalTimeAhead = $item.find('span.bOzv6').first().text().trim() || undefined

      // Duration
      const durationEl = $item.find('div.gvkrdb, li div.Ak5kof div').first()
      const duration = durationEl.text().trim() || "N/A"

      // Stops
      const stopsEl = $item.find('.BbR8Ec .ogfYpf').first()
      const stopsText = stopsEl.text().trim()
      let stops = 0
      if (stopsText && stopsText !== "Nonstop") {
        const match = stopsText.match(/^(\d+)/)
        if (match) stops = parseInt(match[1])
      }

      // Delay
      const delay = $item.find('.GsCCve').first().text().trim() || undefined

      // Price
      const priceEl = $item.find('.YMlIz.FpEdX').first()
      const rawPrice = priceEl.length ? priceEl.text().trim() : ""
      // Strip commas to normalize (e.g., "$1,234" -> "$1234"), fallback to "N/A"
      const price = rawPrice ? rawPrice.replace(/,/g, '') : "N/A"

      // Deep link extraction
      const deep_link = extractDeepLink($item)

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

  return new Result({ current_price, flights })
}

/**
 * Attempts to extract a booking deep link from a flight item element.
 * Tries multiple strategies in order of reliability.
 */
const extractDeepLink = ($item: ReturnType<ReturnType<typeof cheerio.load>>): string | undefined => {
  // Strategy 1: Direct booking link href
  const bookingLink = $item.find('a[href*="/travel/flights/booking"], a[href*="tfs="]').first()
  if (bookingLink.length) {
    const href = bookingLink.attr('href')
    if (href) {
      return href.startsWith('http') ? href : `https://www.google.com${href}`
    }
  }

  // Strategy 2: data-tfs attribute on link elements
  const linkEl = $item.find('a[data-tfs], a[data-url*="booking"]').first()
  if (linkEl.length) {
    const dataTfs = linkEl.attr('data-tfs')
    if (dataTfs) {
      return `https://www.google.com/travel/flights/booking?tfs=${encodeURIComponent(dataTfs)}`
    }
    const dataUrl = linkEl.attr('data-url')
    if (dataUrl) {
      return dataUrl.startsWith('http') ? dataUrl : `https://www.google.com${dataUrl}`
    }
  }

  // Strategy 3: jsdata attribute containing tfs parameter
  const jsDataEl = $item.find('[jsdata*="tfs"], [data-flt-ve]').first()
  if (jsDataEl.length) {
    const jsdata = jsDataEl.attr('jsdata') || ''
    const tfsMatch = jsdata.match(/tfs=([^&\s;]+)/)
    if (tfsMatch) {
      return `https://www.google.com/travel/flights/booking?tfs=${tfsMatch[1]}`
    }
  }

  // Strategy 4: onclick/jsaction attributes
  const clickableEl = $item.find('[onclick*="booking"], [jsaction*="select"]').first()
  const onclick = clickableEl.attr('onclick') || clickableEl.attr('jsaction') || ''
  const urlMatch = onclick.match(/\/travel\/flights\/booking\?[^'"]+/)
  if (urlMatch) {
    return `https://www.google.com${urlMatch[0]}`
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Sorting & Filtering (pure functions, shared across all scraper impls)
// ---------------------------------------------------------------------------

/**
 * Parses a price string to a number, returning Infinity for unparseable values.
 * This ensures "N/A" and other non-numeric prices sort last in ascending order.
 */
export const parsePriceToNumber = (price: string): number => {
  const stripped = price.replace(/[^0-9.-]/g, "")
  const parsed = parseFloat(stripped)
  return Number.isFinite(parsed) && stripped.length > 0 ? parsed : Infinity
}

/**
 * Parses duration string (e.g. "2 hr 30 min") to total minutes.
 */
export const parseDurationToMinutes = (duration: string): number => {
  const hourMatch = duration.match(/(\d+)\s*hr/)
  const minMatch = duration.match(/(\d+)\s*min/)
  const hours = hourMatch ? parseInt(hourMatch[1]) : 0
  const minutes = minMatch ? parseInt(minMatch[1]) : 0
  return hours * 60 + minutes
}

/**
 * Sorts flights based on the specified sort option.
 */
export const sortFlights = (flights: readonly FlightOption[], sortOption: SortOption): FlightOption[] => {
  if (sortOption === "none") return [...flights]

  return [...flights].sort((a, b) => {
    switch (sortOption) {
      case "price-asc":
        return parsePriceToNumber(a.price) - parsePriceToNumber(b.price)
      case "price-desc": {
        const pA = parsePriceToNumber(a.price)
        const pB = parsePriceToNumber(b.price)
        // Infinity (unparseable) sorts last even in descending
        if (!Number.isFinite(pA) && !Number.isFinite(pB)) return 0
        if (!Number.isFinite(pA)) return 1
        if (!Number.isFinite(pB)) return -1
        return pB - pA
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

/**
 * Filters flights based on the provided filter criteria.
 */
export const filterFlights = (flights: readonly FlightOption[], filters: FlightFilters): FlightOption[] => {
  return flights.filter(flight => {
    const price = parsePriceToNumber(flight.price)
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
 * Applies filter, sort, and limit to raw results. Convenience wrapper
 * used by both scraper implementations after fetching/parsing.
 */
export const applyFiltersAndSort = (
  result: Result,
  filters: FlightFilters,
  sortOption: SortOption
): Result => {
  const filtered = filterFlights(result.flights, filters)
  const sorted = sortFlights(filtered, sortOption)
  const limited = typeof filters.limit === "number"
    ? sorted.slice(0, filters.limit)
    : sorted
  return new Result({ current_price: result.current_price, flights: limited })
}
