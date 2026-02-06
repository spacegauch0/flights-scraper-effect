/**
 * Tests for shared parsing, sorting, and filtering logic.
 * These are pure functions with no IO, making them fast and deterministic.
 */

import { describe, expect, test } from "bun:test"
import {
  parsePriceToNumber,
  parseDurationToMinutes,
  sortFlights,
  filterFlights,
  parseFlightsHtml,
  applyFiltersAndSort,
} from "../src/services/parsing"
import { FlightOption, Result } from "../src/domain"

// ---------------------------------------------------------------------------
// parsePriceToNumber
// ---------------------------------------------------------------------------

describe("parsePriceToNumber", () => {
  test("parses dollar amounts", () => {
    expect(parsePriceToNumber("$199")).toBe(199)
    expect(parsePriceToNumber("$1234")).toBe(1234)
    expect(parsePriceToNumber("$99.50")).toBe(99.5)
  })

  test("parses amounts with currency symbols", () => {
    expect(parsePriceToNumber("€250")).toBe(250)
    expect(parsePriceToNumber("£150")).toBe(150)
  })

  test("returns Infinity for N/A and empty strings", () => {
    expect(parsePriceToNumber("N/A")).toBe(Infinity)
    expect(parsePriceToNumber("")).toBe(Infinity)
    expect(parsePriceToNumber("--")).toBe(Infinity)
    expect(parsePriceToNumber("Price unavailable")).toBe(Infinity)
  })

  test("handles zero correctly", () => {
    expect(parsePriceToNumber("$0")).toBe(0)
    expect(parsePriceToNumber("0")).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// parseDurationToMinutes
// ---------------------------------------------------------------------------

describe("parseDurationToMinutes", () => {
  test("parses hours and minutes", () => {
    expect(parseDurationToMinutes("2 hr 30 min")).toBe(150)
    expect(parseDurationToMinutes("1 hr 0 min")).toBe(60)
    expect(parseDurationToMinutes("10 hr 45 min")).toBe(645)
  })

  test("parses hours only", () => {
    expect(parseDurationToMinutes("3 hr")).toBe(180)
  })

  test("parses minutes only", () => {
    expect(parseDurationToMinutes("45 min")).toBe(45)
  })

  test("returns 0 for N/A", () => {
    expect(parseDurationToMinutes("N/A")).toBe(0)
    expect(parseDurationToMinutes("")).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// sortFlights
// ---------------------------------------------------------------------------

const makeFlights = (): FlightOption[] => [
  new FlightOption({ name: "Delta", departure: "8:00 AM", arrival: "2:00 PM", duration: "6 hr", stops: 0, price: "$350" }),
  new FlightOption({ name: "United", departure: "10:00 AM", arrival: "6:00 PM", duration: "8 hr", stops: 1, price: "$200" }),
  new FlightOption({ name: "American", departure: "7:00 AM", arrival: "1:00 PM", duration: "6 hr 30 min", stops: 0, price: "N/A" }),
  new FlightOption({ name: "British Airways", departure: "9:00 AM", arrival: "4:00 PM", duration: "7 hr", stops: 0, price: "$500" }),
]

describe("sortFlights", () => {
  test("sorts by price ascending, N/A last", () => {
    const sorted = sortFlights(makeFlights(), "price-asc")
    expect(sorted[0].name).toBe("United")   // $200
    expect(sorted[1].name).toBe("Delta")     // $350
    expect(sorted[2].name).toBe("British Airways") // $500
    expect(sorted[3].name).toBe("American")  // N/A (Infinity)
  })

  test("sorts by price descending, N/A last", () => {
    const sorted = sortFlights(makeFlights(), "price-desc")
    expect(sorted[0].name).toBe("British Airways") // $500
    expect(sorted[1].name).toBe("Delta")     // $350
    expect(sorted[2].name).toBe("United")    // $200
    expect(sorted[3].name).toBe("American")  // N/A last even in desc
  })

  test("sorts by duration ascending", () => {
    const sorted = sortFlights(makeFlights(), "duration-asc")
    expect(sorted[0].name).toBe("Delta")     // 6 hr = 360 min
    expect(sorted[1].name).toBe("American")  // 6 hr 30 min = 390 min
  })

  test("sorts by airline alphabetically", () => {
    const sorted = sortFlights(makeFlights(), "airline")
    expect(sorted[0].name).toBe("American")
    expect(sorted[1].name).toBe("British Airways")
    expect(sorted[2].name).toBe("Delta")
    expect(sorted[3].name).toBe("United")
  })

  test("'none' preserves original order", () => {
    const flights = makeFlights()
    const sorted = sortFlights(flights, "none")
    expect(sorted.map(f => f.name)).toEqual(flights.map(f => f.name))
  })
})

// ---------------------------------------------------------------------------
// filterFlights
// ---------------------------------------------------------------------------

describe("filterFlights", () => {
  test("filters by maxPrice", () => {
    const filtered = filterFlights(makeFlights(), { maxPrice: 300 })
    expect(filtered).toHaveLength(1) // Only United $200 passes; N/A (Infinity) is excluded
    expect(filtered[0].name).toBe("United")
  })

  test("filters by minPrice (N/A passes since Infinity >= minPrice)", () => {
    const filtered = filterFlights(makeFlights(), { minPrice: 400 })
    // British Airways ($500) passes, American (N/A=Infinity) passes (Infinity >= 400)
    expect(filtered).toHaveLength(2)
    const names = filtered.map(f => f.name).sort()
    expect(names).toContain("British Airways")
    expect(names).toContain("American")
  })

  test("filters by maxDurationMinutes", () => {
    const filtered = filterFlights(makeFlights(), { maxDurationMinutes: 400 })
    expect(filtered).toHaveLength(2) // Delta (360) and American (390)
  })

  test("filters by nonstopOnly", () => {
    const filtered = filterFlights(makeFlights(), { nonstopOnly: true })
    expect(filtered).toHaveLength(3) // All except United (1 stop)
    expect(filtered.every(f => f.stops === 0)).toBe(true)
  })

  test("filters by max_stops", () => {
    const filtered = filterFlights(makeFlights(), { max_stops: 0 })
    expect(filtered).toHaveLength(3)
  })

  test("filters by airlines (case insensitive)", () => {
    const filtered = filterFlights(makeFlights(), { airlines: ["delta", "united"] })
    expect(filtered).toHaveLength(2)
  })

  test("multiple filters are conjunctive (AND)", () => {
    const filtered = filterFlights(makeFlights(), { maxPrice: 400, nonstopOnly: true })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe("Delta") // $350 and nonstop
  })
})

// ---------------------------------------------------------------------------
// applyFiltersAndSort
// ---------------------------------------------------------------------------

describe("applyFiltersAndSort", () => {
  test("applies filter, sort, and limit", () => {
    const result = new Result({ flights: makeFlights() })
    const output = applyFiltersAndSort(result, { nonstopOnly: true, limit: 2 }, "price-asc")
    expect(output.flights).toHaveLength(2)
    expect(output.flights[0].name).toBe("Delta")     // cheapest nonstop
    expect(output.flights[1].name).toBe("British Airways")
  })

  test("preserves current_price from input", () => {
    const result = new Result({ current_price: "low", flights: makeFlights() })
    const output = applyFiltersAndSort(result, {}, "none")
    expect(output.current_price).toBe("low")
  })
})

// ---------------------------------------------------------------------------
// parseFlightsHtml (smoke test with minimal HTML)
// ---------------------------------------------------------------------------

describe("parseFlightsHtml", () => {
  test("returns empty flights for unrelated HTML", () => {
    const result = parseFlightsHtml("<html><body><p>Hello</p></body></html>")
    expect(result.flights).toHaveLength(0)
    expect(result.current_price).toBeUndefined()
  })

  test("extracts price indicator when present", () => {
    const html = `<html><body><span class="gOatQ">Prices are low right now</span></body></html>`
    const result = parseFlightsHtml(html)
    expect(result.current_price).toBe("low")
  })
})
