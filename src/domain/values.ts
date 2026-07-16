/**
 * Shared value conventions: the flight designator, price strings, duration
 * strings, and 12-hour clock strings that multiple modules exchange. One
 * home for each parse/format pair so the conventions cannot drift.
 */

/**
 * A marketing-carrier flight designator, e.g. "BA178": two-character
 * carrier code + flight number. Decoded from Google's booking tokens and
 * used to select a specific flight in the booking-options and multi-city
 * RPC calls.
 */
export interface FlightDesignator {
  readonly carrier: string
  readonly number: string
}

export const parseDesignator = (value: string): FlightDesignator | undefined => {
  const match = value.match(/^([A-Z0-9]{2})(\d+[A-Z]?)$/i)
  if (!match) return undefined
  return { carrier: match[1].toUpperCase(), number: match[2].toUpperCase() }
}

export const formatDesignator = (designator: FlightDesignator): string => `${designator.carrier}${designator.number}`

/** Parses a formatted price ("$1,234", "USD 431") into a number; unparseable -> 0 */
export const parsePrice = (price: string): number => parseFloat(price.replace(/[^0-9.]/g, "")) || 0

/** Parses a duration string like "12 hr 30 min" into total minutes */
export const parseDurationToMinutes = (duration: string): number => {
  const hourMatch = duration.match(/(\d+)\s*hr/)
  const minMatch = duration.match(/(\d+)\s*min/)
  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0
  const minutes = minMatch ? parseInt(minMatch[1], 10) : 0
  return hours * 60 + minutes
}

/** Formats total minutes as the scraper's duration convention: "12 hr 30 min" */
export const formatDurationHrMin = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`
}

/** Formats a 24-hour time as the scraper's clock convention: "8:25 PM" */
export const formatClock12 = (hours24: number, minutes: number): string => {
  const period = hours24 >= 12 ? "PM" : "AM"
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`
}
