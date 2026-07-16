/**
 * Domain types and schemas for the Google Flights scraper
 */

import { Schema } from "effect"

/** Defines the trip type for flight searches */
export const TripTypeSchema = Schema.Literals(["one-way", "round-trip", "multi-city"])
export type TripType = Schema.Schema.Type<typeof TripTypeSchema>

/** Defines the seat/cabin class for flight searches */
export const SeatClassSchema = Schema.Literals(["economy", "premium-economy", "business", "first"])
export type SeatClass = Schema.Schema.Type<typeof SeatClassSchema>

/** Defines passenger counts for flight searches */
export const PassengersSchema = Schema.Struct({
  adults: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  children: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  infants_in_seat: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  infants_on_lap: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
})
export interface Passengers extends Schema.Schema.Type<typeof PassengersSchema> {}

/** Airport code schema (3-letter IATA codes) */
export const AirportCodeSchema = Schema.String.check(
  Schema.isLengthBetween(3, 3),
  Schema.isPattern(/^[A-Z]{3}$/)
).pipe(Schema.brand("AirportCode"))
export type AirportCode = Schema.Schema.Type<typeof AirportCodeSchema>

/** Date schema (YYYY-MM-DD format) */
export const DateStringSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)
).pipe(Schema.brand("DateString"))
export type DateString = Schema.Schema.Type<typeof DateStringSchema>

/** A single origin/destination/date leg beyond the first, used for multi-city itineraries */
export const FlightLegSchema = Schema.Struct({
  from: AirportCodeSchema,
  to: AirportCodeSchema,
  date: DateStringSchema
})
export interface FlightLeg extends Schema.Schema.Type<typeof FlightLegSchema> {}

/** Defines the sorting options for flight results */
export const SortOptionSchema = Schema.Literals([
  "price-asc",      // Price: low to high
  "price-desc",     // Price: high to low
  "duration-asc",   // Duration: shortest to longest
  "duration-desc",  // Duration: longest to shortest
  "airline",        // Airline: alphabetical
  "none"            // No sorting (default order)
])
export type SortOption = Schema.Schema.Type<typeof SortOptionSchema>

/** Defines what the clean, desired output looks like */
export const FlightOption = Schema.Struct({
  is_best: Schema.optional(Schema.Boolean),
  name: Schema.String,         // Airline name(s)
  departure: Schema.String,    // Departure time
  arrival: Schema.String,      // Arrival time
  arrival_time_ahead: Schema.optional(Schema.String), // "+1 day" if arrives next day
  duration: Schema.String,     // Flight duration
  stops: Schema.Number,        // Number of stops
  delay: Schema.optional(Schema.String), // Delay information if any
  price: Schema.String,        // Price as formatted string
  deep_link: Schema.optional(Schema.String), // Direct booking/details link
  flight_number: Schema.optional(Schema.String) // Marketing carrier + number, e.g. "BA178" - used to look up booking options
})
export interface FlightOption extends Schema.Schema.Type<typeof FlightOption> {}

/** A single "Book with X" option from Google Flights' booking-options panel */
export const BookingOption = Schema.Struct({
  providerCode: Schema.String,     // e.g. "FR", "BOOKING_COM"
  provider: Schema.String,         // e.g. "Ryanair", "Booking.com"
  price: Schema.optional(Schema.String), // Formatted price for this provider, if Google returned one
  url: Schema.String               // google.com/travel/clk/f redirect that lands on the provider's booking page
})
export interface BookingOption extends Schema.Schema.Type<typeof BookingOption> {}

/** Result with price indicator and flights */
export const Result = Schema.Struct({
  current_price: Schema.optional(Schema.Literals(["low", "typical", "high"])),
  flights: Schema.Array(FlightOption)
})
export interface Result extends Schema.Schema.Type<typeof Result> {}

/** Defines filtering options for flight results */
export const FlightFiltersSchema = Schema.Struct({
  /** Maximum price (inclusive). Flights above this price will be excluded. */
  maxPrice: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),

  /** Minimum price (inclusive). Flights below this price will be excluded. */
  minPrice: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),

  /** Maximum duration in minutes. Flights longer than this will be excluded. */
  maxDurationMinutes: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),

  /** Filter by specific airlines. Only flights from these airlines will be included. */
  airlines: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),

  /** Filter by number of stops. If true, only nonstop flights are included. */
  nonstopOnly: Schema.optionalKey(Schema.Boolean),

  /** Maximum number of stops (0 = nonstop, 1 = up to 1 stop, 2 = up to 2 stops) */
  max_stops: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 2 }))),

  /**
   * Maximum number of results to return. Applied after filtering and sorting.
   * Use "all" to automatically load all results by clicking "View more flights".
   */
  limit: Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)), Schema.Literal("all")]))
})
export interface FlightFilters extends Schema.Schema.Type<typeof FlightFiltersSchema> {}

/**
 * A complete, validated flight-search request - the single argument to
 * ScraperService.scrape. Decode untrusted input (CLI flags, TUI form values)
 * against this schema at the boundary; airport codes and dates are branded so
 * an unvalidated string cannot reach the scraper.
 */
export const ScrapeRequestSchema = Schema.Struct({
  from: AirportCodeSchema,
  to: AirportCodeSchema,
  departDate: DateStringSchema,
  tripType: TripTypeSchema,
  returnDate: Schema.optionalKey(DateStringSchema),
  sortOption: SortOptionSchema,
  filters: FlightFiltersSchema,
  seat: SeatClassSchema,
  passengers: PassengersSchema,
  currency: Schema.optionalKey(Schema.String),
  /** Legs 2+ beyond from/to/departDate, used when tripType is "multi-city" */
  additionalLegs: Schema.optionalKey(Schema.Array(FlightLegSchema))
})
export interface ScrapeRequest extends Schema.Schema.Type<typeof ScrapeRequestSchema> {}
