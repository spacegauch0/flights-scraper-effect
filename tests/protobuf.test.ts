/**
 * Tests for protobuf encoding utilities.
 * Verifies that encodeFlightSearch produces valid base64 and that
 * the module-level schema is correctly initialized.
 */

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { encodeFlightSearch, buildFlightUrl } from "../src/utils/protobuf"

describe("encodeFlightSearch", () => {
  test("produces non-empty URL-safe base64 for one-way flight", async () => {
    const result = await encodeFlightSearch(
      [{ date: "2026-06-15", from_airport: "JFK", to_airport: "LHR" }],
      "one-way",
      "economy",
      { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }
    ).pipe(Effect.runPromise)

    expect(result.length).toBeGreaterThan(0)
    // URL-safe base64 should not contain +, /, or =
    expect(result).not.toMatch(/[+/=]/)
  })

  test("produces different output for different airports", async () => {
    const params = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 } as const
    const a = await encodeFlightSearch(
      [{ date: "2026-06-15", from_airport: "JFK", to_airport: "LHR" }],
      "one-way", "economy", params
    ).pipe(Effect.runPromise)

    const b = await encodeFlightSearch(
      [{ date: "2026-06-15", from_airport: "LAX", to_airport: "NRT" }],
      "one-way", "economy", params
    ).pipe(Effect.runPromise)

    expect(a).not.toBe(b)
  })

  test("round-trip produces different output than one-way", async () => {
    const params = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 } as const
    const oneWay = await encodeFlightSearch(
      [{ date: "2026-06-15", from_airport: "JFK", to_airport: "LHR" }],
      "one-way", "economy", params
    ).pipe(Effect.runPromise)

    const roundTrip = await encodeFlightSearch(
      [
        { date: "2026-06-15", from_airport: "JFK", to_airport: "LHR" },
        { date: "2026-06-30", from_airport: "LHR", to_airport: "JFK" }
      ],
      "round-trip", "economy", params
    ).pipe(Effect.runPromise)

    expect(oneWay).not.toBe(roundTrip)
    expect(roundTrip.length).toBeGreaterThan(oneWay.length)
  })

  test("different seat classes produce different output", async () => {
    const data = [{ date: "2026-06-15", from_airport: "JFK", to_airport: "LHR" }]
    const params = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 } as const

    const economy = await encodeFlightSearch(data, "one-way", "economy", params).pipe(Effect.runPromise)
    const business = await encodeFlightSearch(data, "one-way", "business", params).pipe(Effect.runPromise)

    expect(economy).not.toBe(business)
  })
})

describe("buildFlightUrl", () => {
  test("produces a valid Google Flights URL", async () => {
    const url = await buildFlightUrl(
      [{ date: "2026-06-15", from_airport: "JFK", to_airport: "LHR" }],
      "one-way",
      "economy",
      { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
      "USD"
    ).pipe(Effect.runPromise)

    expect(url).toContain("https://www.google.com/travel/flights")
    expect(url).toContain("tfs=")
    expect(url).toContain("curr=USD")
  })
})
