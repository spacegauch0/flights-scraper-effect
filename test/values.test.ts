import { describe, expect, test } from "bun:test"
import { formatClock12, formatDesignator, formatDurationHrMin, parseDesignator, parseDurationToMinutes, parsePrice } from "../src/domain/values"

describe("FlightDesignator", () => {
  test("parses carrier + number", () => {
    expect(parseDesignator("BA178")).toEqual({ carrier: "BA", number: "178" })
    expect(parseDesignator("U24312")).toEqual({ carrier: "U2", number: "4312" })
    expect(parseDesignator("ba178")).toEqual({ carrier: "BA", number: "178" })
  })

  test("rejects non-designators", () => {
    expect(parseDesignator("")).toBeUndefined()
    expect(parseDesignator("BOEING")).toBeUndefined()
    expect(parseDesignator("B1")).toBeUndefined()
  })

  test("format is the inverse of parse", () => {
    for (const value of ["BA178", "LH1", "U24312"]) {
      const parsed = parseDesignator(value)
      expect(parsed && formatDesignator(parsed)).toBe(value)
    }
  })
})

describe("price and duration values", () => {
  test("parsePrice handles the formats the scraper produces", () => {
    expect(parsePrice("$1,234")).toBe(1234)
    expect(parsePrice("USD 431")).toBe(431)
    expect(parsePrice("N/A")).toBe(0)
  })

  test("duration round-trips through format and parse", () => {
    for (const minutes of [60, 435, 720, 930]) {
      expect(parseDurationToMinutes(formatDurationHrMin(minutes))).toBe(minutes)
    }
    expect(formatDurationHrMin(750)).toBe("12 hr 30 min")
    expect(formatDurationHrMin(720)).toBe("12 hr")
  })

  test("formatClock12 covers midnight and noon", () => {
    expect(formatClock12(0, 5)).toBe("12:05 AM")
    expect(formatClock12(12, 0)).toBe("12:00 PM")
    expect(formatClock12(20, 25)).toBe("8:25 PM")
  })
})
