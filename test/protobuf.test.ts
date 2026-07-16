/**
 * Golden tests for the tfs protobuf encoder - the values below were
 * produced by this encoder and verified against live Google Flights
 * responses (the URLs returned real results), so they pin the wire format.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { buildFlightUrl, encodeFlightSearch } from "../src/utils/protobuf"

const PASSENGERS = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }

describe("encodeFlightSearch", () => {
  test("golden: one-way JFK->LHR economy 1 adult", () => {
    const tfs = Effect.runSync(encodeFlightSearch([{ date: "2026-08-20", from_airport: "JFK", to_airport: "LHR" }], "one-way", "economy", PASSENGERS))
    expect(tfs).toBe("GhoSCjIwMjYtMDgtMjBqBRIDSkZLcgUSA0xIUkIBAUgBmAEC")
  })

  test("golden: max_stops changes the encoding", () => {
    const tfs = Effect.runSync(encodeFlightSearch([{ date: "2026-08-20", from_airport: "JFK", to_airport: "LHR", max_stops: 2 }], "one-way", "economy", PASSENGERS))
    expect(tfs).toBe("GhwSCjIwMjYtMDgtMjAoAmoFEgNKRktyBRIDTEhSQgEBSAGYAQI")
  })

  test("round-trip encodes both directions and differs from one-way", () => {
    const oneWay = Effect.runSync(encodeFlightSearch([{ date: "2026-08-20", from_airport: "JFK", to_airport: "LHR" }], "one-way", "economy", PASSENGERS))
    const roundTrip = Effect.runSync(
      encodeFlightSearch(
        [
          { date: "2026-08-20", from_airport: "JFK", to_airport: "LHR" },
          { date: "2026-08-27", from_airport: "LHR", to_airport: "JFK" },
        ],
        "round-trip",
        "economy",
        PASSENGERS,
      ),
    )
    expect(roundTrip).not.toBe(oneWay)
    expect(roundTrip.length).toBeGreaterThan(oneWay.length)
  })

  test("output is URL-safe base64", () => {
    const tfs = Effect.runSync(
      encodeFlightSearch([{ date: "2026-08-20", from_airport: "JFK", to_airport: "LHR" }], "one-way", "business", {
        adults: 2,
        children: 1,
        infants_in_seat: 0,
        infants_on_lap: 1,
      }),
    )
    expect(tfs).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe("buildFlightUrl", () => {
  test("assembles the search URL with tfs, language, and currency", () => {
    const url = Effect.runSync(buildFlightUrl([{ date: "2026-08-20", from_airport: "JFK", to_airport: "LHR" }], "one-way", "economy", PASSENGERS, "USD"))
    expect(url).toStartWith("https://www.google.com/travel/flights?tfs=")
    expect(url).toContain("hl=en")
    expect(url).toContain("curr=USD")
  })
})
