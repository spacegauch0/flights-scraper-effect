/**
 * Shared flight-list parsing, filtering, and sorting logic.
 * Used by every ScraperService adapter so HTML parsing and result
 * post-processing live in exactly one place.
 */

import * as cheerio from "cheerio"
import { FlightOption, Result, SortOption, FlightFilters } from "../domain"

/**
 * Google embeds a protobuf-encoded "booking token" per flight in the page's
 * AF_initDataCallback data, right after that flight's client-side id (the
 * `ssk`/`data-id` attribute on its DOM node). Field 2 of that token is the
 * flight's own marketing-carrier designator (e.g. "BA178") - decoding it is
 * far more reliable than trying to scrape a flight number out of the visible
 * (and often absent) card text.
 */
const decodeFlightDesignator = (tokenBase64: string): string | undefined => {
  try {
    const bytes = Buffer.from(tokenBase64.replace(/\\u003d/g, "="), "base64")
    let offset = 0

    const readVarint = (): number => {
      let result = 0
      let shift = 0
      while (offset < bytes.length) {
        const byte = bytes[offset++]
        result |= (byte & 0x7f) << shift
        if ((byte & 0x80) === 0) break
        shift += 7
      }
      return result
    }

    while (offset < bytes.length) {
      const tag = readVarint()
      const field = tag >>> 3
      const wireType = tag & 0x7

      if (wireType === 2) {
        const length = readVarint()
        const value = bytes.subarray(offset, offset + length)
        offset += length
        if (field === 2) return value.toString("utf8")
      } else if (wireType === 0) {
        readVarint()
      } else {
        break
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Extracts the `data:` payload of every `AF_initDataCallback({...})` block on
 * the page. Google splits page state across several of these; the one with
 * the flight itineraries varies in size and key from request to request, so
 * every block is parsed and searched.
 */
const extractDataBlobs = (html: string): unknown[] => {
  const blobs: unknown[] = []
  const pattern = /AF_initDataCallback\(\{key: '[^']*', hash: '[^']*', data:([\s\S]*?), sideChannel/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    try {
      blobs.push(JSON.parse(match[1]))
    } catch {
      // Not every block is a clean JSON array (some contain bare identifiers) - skip those.
    }
  }
  return blobs
}

const isTokenPair = (value: unknown): value is [[null, number], string] =>
  Array.isArray(value) && value.length === 2 &&
  Array.isArray(value[0]) && value[0].length === 2 && value[0][0] === null && typeof value[0][1] === "number" &&
  typeof value[1] === "string" && value[1].startsWith("Cj")

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{5,8}$/

/**
 * Each flight's client-side id (its `ssk`/`data-id` DOM attribute) sits deep
 * inside one itinerary entry; that entry's own booking token is a sibling a
 * few levels up. Walking the tree with an ancestor stack finds the nearest
 * enclosing token for any id, however deep the id itself is nested.
 */
const collectBookingTokensByClientId = (node: unknown, ancestors: unknown[][], into: Map<string, string>): void => {
  if (!Array.isArray(node)) return

  for (const value of node) {
    if (typeof value === "string" && CLIENT_ID_PATTERN.test(value) && !into.has(value)) {
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const pair = ancestors[i].find(isTokenPair)
        if (pair) {
          into.set(value, (pair as [[null, number], string])[1])
          break
        }
      }
    }
  }

  for (const child of node) {
    collectBookingTokensByClientId(child, [...ancestors, node], into)
  }
}

/**
 * Builds a client-id -> marketing-carrier-designator (e.g. "BA178") map for
 * every flight on the page, decoded from each flight's own booking token.
 */
const buildFlightDesignatorMap = (html: string): Map<string, string> => {
  const tokensByClientId = new Map<string, string>()
  for (const blob of extractDataBlobs(html)) {
    collectBookingTokensByClientId(blob, [], tokensByClientId)
  }

  const designatorsByClientId = new Map<string, string>()
  for (const [clientId, token] of tokensByClientId) {
    const designator = decodeFlightDesignator(token)
    if (designator) designatorsByClientId.set(clientId, designator)
  }
  return designatorsByClientId
}

/**
 * HTML parser based on reference implementation from fast_flights
 */
export const parseHtmlFallback = (html: string): Result => {
  const $ = cheerio.load(html)
  const flights: FlightOption[] = []
  const flightDesignators = buildFlightDesignatorMap(html)

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

      // Marketing-carrier designator (e.g. "BA178"), decoded from this flight's
      // own booking token - used later to look up booking options on demand.
      const clientId = ($item.attr('ssk') || '').split(':')[1]
      const flight_number = clientId ? flightDesignators.get(clientId) : undefined

      if (name !== "Unknown") {
        flights.push(FlightOption.make({
          is_best: isBestSection && itemIndex === 0,
          name,
          departure,
          arrival,
          arrival_time_ahead: arrivalTimeAhead,
          duration,
          stops,
          delay,
          price,
          deep_link,
          flight_number
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

  return Result.make({
    current_price,
    flights
  })
}

/**
 * Parses a duration string like "12 hr 30 min" into total minutes
 */
export const parseDurationToMinutes = (duration: string): number => {
  const hourMatch = duration.match(/(\d+)\s*hr/)
  const minMatch = duration.match(/(\d+)\s*min/)
  const hours = hourMatch ? parseInt(hourMatch[1]) : 0
  const minutes = minMatch ? parseInt(minMatch[1]) : 0
  return hours * 60 + minutes
}

/**
 * Parses a formatted price string (e.g. "$299,733") into a plain number
 */
export const parsePrice = (price: string): number => parseFloat(price.replace(/[^0-9.-]/g, "")) || 0

/**
 * Sorts flights based on the specified option
 */
export const sortFlights = (flights: readonly FlightOption[], sortOption: SortOption): FlightOption[] => {
  if (sortOption === "none") return [...flights]

  return [...flights].sort((a, b) => {
    switch (sortOption) {
      case "price-asc":
        return parsePrice(a.price) - parsePrice(b.price)
      case "price-desc":
        return parsePrice(b.price) - parsePrice(a.price)
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
 * Filters flights based on criteria
 */
export const filterFlights = (flights: readonly FlightOption[], filters: FlightFilters): FlightOption[] => {
  return flights.filter(flight => {
    const price = parsePrice(flight.price)
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
 * Applies filtering, sorting, and the result limit in one step.
 * Every ScraperService adapter should funnel its raw parsed Result through
 * this before returning it, so the three operations always stay in sync.
 */
export const applyFiltersSortAndLimit = (
  result: Result,
  filters: FlightFilters,
  sortOption: SortOption
): Result => {
  const filtered = filterFlights(result.flights, filters)
  const sorted = sortFlights(filtered, sortOption)
  const limited = typeof filters.limit === "number" ? sorted.slice(0, filters.limit) : sorted

  return Result.make({ current_price: result.current_price, flights: limited })
}
