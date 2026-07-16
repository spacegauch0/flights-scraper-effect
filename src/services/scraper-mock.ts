/**
 * Deterministic, network-free ScraperService for TUI development.
 * Run the TUI against it with `bun run tui:mock` - instant results, no
 * Google traffic, stable data for iterating on layout and interactions.
 *
 * Flights are generated from a seed derived from the search route, so the
 * same search always shows the same flights. No flight_number is set, so
 * "open flight" uses the deep_link instead of the booking-options endpoint
 * (which would hit the network).
 */

import { Effect, Layer } from "effect"
import { FlightOption, Result, ScrapeRequest } from "../domain"
import { applyFiltersSortAndLimit } from "./flight-parsing"
import { ScraperService } from "./scraper"

const AIRLINES = [
  "British Airways", "Virgin Atlantic", "American", "Delta", "United",
  "Lufthansa", "KLM", "Air France", "Iberia", "JetBlue", "Norse Atlantic", "TAP Air Portugal"
]

/** Small deterministic PRNG (mulberry32) seeded from the search route */
const makeRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const stringSeed = (value: string): number => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const formatClock = (minutesFromMidnight: number): string => {
  const clamped = ((minutesFromMidnight % 1440) + 1440) % 1440
  const hours24 = Math.floor(clamped / 60)
  const minutes = clamped % 60
  const period = hours24 >= 12 ? "PM" : "AM"
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`
}

const mockFlights = (request: ScrapeRequest): FlightOption[] => {
  const random = makeRandom(stringSeed(`${request.from}-${request.to}-${request.departDate}`))
  const count = 24 + Math.floor(random() * 16)

  return Array.from({ length: count }, (_, index) => {
    const departMinutes = 5 * 60 + Math.floor(random() * 210) * 5
    const durationMinutes = 6 * 60 + Math.floor(random() * 150) * 5
    const stops = random() < 0.45 ? 0 : random() < 0.8 ? 1 : 2
    const arriveMinutes = departMinutes + durationMinutes + stops * 90
    const hours = Math.floor((durationMinutes + stops * 90) / 60)
    const minutes = (durationMinutes + stops * 90) % 60
    const price = 180 + Math.floor(random() * 24) * 25 + stops * -40 + Math.floor(random() * 30)

    return FlightOption.make({
      is_best: index === 0,
      name: AIRLINES[Math.floor(random() * AIRLINES.length)],
      departure: `${formatClock(departMinutes)} on Thu, Aug 20`,
      arrival: `${formatClock(arriveMinutes)} on ${arriveMinutes >= 1440 ? "Fri, Aug 21" : "Thu, Aug 20"}`,
      arrival_time_ahead: arriveMinutes >= 1440 ? "+1" : undefined,
      duration: minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`,
      stops,
      price: `$${Math.max(90, price)}`,
      deep_link: "https://www.google.com/travel/flights"
    })
  })
}

export const ScraperMockLive = Layer.succeed(
  ScraperService,
  ScraperService.of({
    scrape: Effect.fn("Scraper.scrape")(function* (request: ScrapeRequest) {
      // Simulated latency so loading states are visible while iterating
      yield* Effect.sleep("400 millis")
      const result = Result.make({ current_price: "typical", flights: mockFlights(request) })
      return applyFiltersSortAndLimit(result, request.filters, request.sortOption)
    })
  })
)
