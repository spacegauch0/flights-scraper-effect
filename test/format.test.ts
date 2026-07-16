import { describe, expect, test } from "bun:test"
import { formatDateTimeCompact, formatDurationCompact, TABLE_COLUMNS } from "../src/tui/format"

describe("formatDateTimeCompact", () => {
  test("scraped values become fixed-width 24-hour day + time", () => {
    expect(formatDateTimeCompact("8:20 AM on Wed, Jan 14")).toBe("Wed 08:20")
    expect(formatDateTimeCompact("12:15 PM on Thu, Aug 20")).toBe("Thu 12:15")
    expect(formatDateTimeCompact("12:25 AM on Fri, Aug 21")).toBe("Fri 00:25")
    expect(formatDateTimeCompact("11:55 PM on Sat, Aug 22")).toBe("Sat 23:55")
  })

  test("day-less times (multi-city legs) convert too", () => {
    expect(formatDateTimeCompact("10:40 PM")).toBe("22:40")
    expect(formatDateTimeCompact("9:05 AM")).toBe("09:05")
  })

  test("every formatted time in a column has the same width", () => {
    const values = ["8:20 AM on Wed, Jan 14", "12:15 PM on Thu, Aug 20", "1:05 AM on Fri, Aug 21"]
    const widths = new Set(values.map((v) => formatDateTimeCompact(v).length))
    expect(widths.size).toBe(1)
  })

  test("unparseable values pass through", () => {
    expect(formatDateTimeCompact("")).toBe("-")
    expect(formatDateTimeCompact("N/A")).toBe("N/A")
  })
})

describe("formatDurationCompact", () => {
  test("compacts hr/min", () => {
    expect(formatDurationCompact("15 hr 30 min")).toBe("15h 30m")
    expect(formatDurationCompact("12 hr")).toBe("12h")
  })
})

describe("TABLE_COLUMNS", () => {
  test("fits the results pane on a 120-column terminal", () => {
    const total = TABLE_COLUMNS.reduce((sum, col) => sum + col.width, 0)
    expect(total).toBeLessThanOrEqual(84)
  })
})
