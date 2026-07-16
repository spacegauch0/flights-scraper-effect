/**
 * Pure formatting and table-rendering helpers for the TUI.
 * No OpenTUI or Effect dependencies - these are plain string/array transforms.
 */

import type { FlightOption } from "../domain"
import { parseDurationToMinutes, parsePrice } from "../domain"

/**
 * Semantic color palette: names describe roles, not hues, so a future theme
 * (or terminal-derived palette) only has to swap this one object.
 */
export const colors = {
  /** App background */
  background: "#0f172a",
  /** Raised panels (form, results pane) */
  surface: "#1e293b",
  /** Primary text */
  text: "#f1f5f9",
  /** Secondary text, labels, inactive hints */
  muted: "#94a3b8",
  /** Panel and table borders */
  border: "#334155",
  /** Selection background, sort indicator, active tab */
  accent: "#38bdf8",
  /** Text drawn on top of an accent-colored selection */
  selectedText: "#0f172a",
  /** Focused input background */
  focusBg: "#0284c7",
  /** Key names in the footer legend */
  hintKey: "#22d3ee",
  success: "#22c55e",
  warning: "#eab308",
  error: "#ef4444",
  /** Table header row background */
  headerBg: "#1e3a5f",
  /** Footer legend background */
  legendBg: "#0b1220",
  /** Row background for the "best flight" row */
  bestRowBg: "#1a3a2a",
}

/** Table column definition */
export interface TableColumn {
  key: string
  label: string
  width: number
  sortable: boolean
}

// Widths (incl. 2-char separators) must fit the results pane on a 120-col
// terminal: 120 - 2 outer padding - 32 form - 2 gap = 84. Sum here is 75,
// sized so the longest real value in each column fits without an ellipsis
// ("Thu 08:25", "Fri 04:55 +1", "15h 30m", "Nonstop", "$1,999").
export const TABLE_COLUMNS: TableColumn[] = [
  { key: "name", label: "Airline", width: 24, sortable: true },
  { key: "departure", label: "Departure", width: 11, sortable: true },
  { key: "arrival", label: "Arrival", width: 14, sortable: true },
  { key: "duration", label: "Duration", width: 10, sortable: true },
  { key: "stops", label: "Stops", width: 9, sortable: true },
  { key: "price", label: "Price", width: 7, sortable: true },
]

/** Board-compact duration: "15 hr 30 min" -> "15h 30m", "12 hr" -> "12h" */
export function formatDurationCompact(duration: string): string {
  return duration.replace(/\s*hr\b/, "h").replace(/\s*min\b/, "m")
}

/** Sort flights by a table column key and direction (used for the results table) */
export function sortFlightsByColumn(flights: FlightOption[], column: string, asc: boolean): FlightOption[] {
  return [...flights].sort((a, b) => {
    let cmp = 0
    switch (column) {
      case "name":
        cmp = a.name.localeCompare(b.name)
        break
      case "departure":
        cmp = a.departure.localeCompare(b.departure)
        break
      case "arrival":
        cmp = a.arrival.localeCompare(b.arrival)
        break
      case "duration":
        cmp = parseDurationToMinutes(a.duration) - parseDurationToMinutes(b.duration)
        break
      case "stops":
        cmp = a.stops - b.stops
        break
      case "price":
        cmp = parsePrice(a.price) - parsePrice(b.price)
        break
    }
    return asc ? cmp : -cmp
  })
}

/** Calculate the visual width of a string (accounting for emojis and wide chars) */
export function getVisualWidth(str: string): number {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0) || 0
    // Emoji and wide characters typically take 2 columns in terminal
    if (code >= 0x1F000 || // Emoji and symbols (1F000+)
        (code >= 0x2300 && code <= 0x23FF) || // Misc technical
        (code >= 0x2600 && code <= 0x27BF) || // Misc symbols
        (code >= 0x2B00 && code <= 0x2BFF) || // Misc symbols and arrows (includes ⭐ U+2B50)
        (code >= 0x2900 && code <= 0x297F) || // Supplemental arrows
        (code >= 0x1100 && code <= 0x11FF) || // Korean Jamo
        (code >= 0x3000 && code <= 0x9FFF) || // CJK
        (code >= 0xAC00 && code <= 0xD7AF) || // Korean Hangul
        (code >= 0xFE00 && code <= 0xFE0F)) { // Variation selectors
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

/** Pad/truncate string to fixed width with separator (handles Unicode properly) */
export function fixedWidth(str: string, width: number, addSep = true, align: "left" | "right" = "left"): string {
  const maxContent = width - (addSep ? 2 : 0)
  let content = str
  let visualWidth = getVisualWidth(content)

  // Truncate if too long
  if (visualWidth > maxContent) {
    content = ""
    visualWidth = 0
    for (const char of str) {
      const charWidth = getVisualWidth(char)
      if (visualWidth + charWidth > maxContent - 1) break
      content += char
      visualWidth += charWidth
    }
    content += "…"
    visualWidth += 1
  }

  // Pad to fixed width
  const padding = maxContent - visualWidth
  if (padding > 0) {
    if (align === "right") {
      content = " ".repeat(padding) + content
    } else {
      content = content + " ".repeat(padding)
    }
  }

  return addSep ? content + "│ " : content
}

/** Human friendly price formatter (USD) */
export function formatPrice(price: string): string {
  const numeric = parseFloat(price.replace(/[^0-9.]/g, ""))
  if (Number.isNaN(numeric)) return price || "-"
  return `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

/** Friendly stops text */
export function formatStops(stops: number): string {
  if (stops === 0) return "Nonstop"
  if (stops === 1) return "1 stop"
  return `${stops} stops`
}

/**
 * Fixed-width compact date/time: 24-hour zero-padded, so every value in a
 * column is the same size. "8:20 AM on Wed, Jan 14" -> "Wed 08:20",
 * "10:40 PM" -> "22:40".
 */
export function formatDateTimeCompact(value: string): string {
  if (!value) return "-"
  const time = value.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i)
  if (!time) return value.replace(" on ", " ").replace(/,\s*/g, " ")

  const hour12 = parseInt(time[1], 10) % 12
  const hour24 = time[3].toUpperCase() === "PM" ? hour12 + 12 : hour12
  const clock = `${String(hour24).padStart(2, "0")}:${time[2]}`

  const day = value.match(/\bon\s+([A-Za-z]{3})/)?.[1]
  return day ? `${day} ${clock}` : clock
}
