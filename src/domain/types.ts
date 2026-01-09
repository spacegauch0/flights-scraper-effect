/**
 * Domain types and schemas for the Google Flights scraper
 */

import { Schema } from "@effect/schema"

/** Defines the trip type for flight searches */
export const TripTypeSchema = Schema.Literal("one-way", "round-trip", "multi-city")
export type TripType = Schema.Schema.Type<typeof TripTypeSchema>

/** Defines the seat/cabin class for flight searches */
export const SeatClassSchema = Schema.Literal("economy", "premium-economy", "business", "first")
export type SeatClass = Schema.Schema.Type<typeof SeatClassSchema>

/** Defines passenger counts for flight searches */
export const PassengersSchema = Schema.Struct({
  adults: Schema.Number.pipe(Schema.int(), Schema.positive()),
  children: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  infants_in_seat: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  infants_on_lap: Schema.Number.pipe(Schema.int(), Schema.nonNegative())
})
export type Passengers = Schema.Schema.Type<typeof PassengersSchema>

/** Airport code schema (3-letter IATA codes) */
export const AirportCodeSchema = Schema.String.pipe(
  Schema.length(3),
  Schema.pattern(/^[A-Z]{3}$/),
  Schema.brand("AirportCode")
)
export type AirportCode = Schema.Schema.Type<typeof AirportCodeSchema>

/** Date schema (YYYY-MM-DD format) */
export const DateStringSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.brand("DateString")
)
export type DateString = Schema.Schema.Type<typeof DateStringSchema>

/** Defines the sorting options for flight results */
export const SortOptionSchema = Schema.Literal(
  "price-asc",      // Price: low to high
  "price-desc",     // Price: high to low
  "duration-asc",   // Duration: shortest to longest
  "duration-desc",  // Duration: longest to shortest
  "airline",        // Airline: alphabetical
  "none"            // No sorting (default order)
)
export type SortOption = Schema.Schema.Type<typeof SortOptionSchema>

/** Defines what the clean, desired output looks like */
export class FlightOption extends Schema.Class<FlightOption>("FlightOption")({
  is_best: Schema.optional(Schema.Boolean),
  name: Schema.String,         // Airline name(s)
  departure: Schema.String,    // Departure time
  arrival: Schema.String,      // Arrival time
  arrival_time_ahead: Schema.optional(Schema.String), // "+1 day" if arrives next day
  duration: Schema.String,     // Flight duration
  stops: Schema.Number,        // Number of stops
  delay: Schema.optional(Schema.String), // Delay information if any
  price: Schema.String,        // Price as formatted string
  deep_link: Schema.optional(Schema.String) // Direct booking/details link
}) {}

/** Result with price indicator and flights */
export class Result extends Schema.Class<Result>("Result")({
  current_price: Schema.optional(Schema.Literal("low", "typical", "high")),
  flights: Schema.Array(FlightOption)
}) {}

/** Defines filtering options for flight results */
export const FlightFiltersSchema = Schema.Struct({
  /** Maximum price (inclusive). Flights above this price will be excluded. */
  maxPrice: Schema.optional(Schema.Number.pipe(Schema.positive())),
  
  /** Minimum price (inclusive). Flights below this price will be excluded. */
  minPrice: Schema.optional(Schema.Number.pipe(Schema.positive())),
  
  /** Maximum duration in minutes. Flights longer than this will be excluded. */
  maxDurationMinutes: Schema.optional(Schema.Number.pipe(Schema.positive())),
  
  /** Filter by specific airlines. Only flights from these airlines will be included. */
  airlines: Schema.optional(Schema.Array(Schema.String).pipe(Schema.mutable)),
  
  /** Filter by number of stops. If true, only nonstop flights are included. */
  nonstopOnly: Schema.optional(Schema.Boolean),
  
  /** Maximum number of stops (0 = nonstop, 1 = up to 1 stop, 2 = up to 2 stops) */
  max_stops: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 2))),
  
  /** 
   * Maximum number of results to return. Applied after filtering and sorting.
   * Use "all" to automatically load all results by clicking "View more flights".
   */
  limit: Schema.optional(Schema.Union(Schema.Number.pipe(Schema.int(), Schema.positive()), Schema.Literal("all")))
})
export type FlightFilters = Schema.Schema.Type<typeof FlightFiltersSchema>

/** Legacy alias for backward compatibility */
export type Flight = FlightOption

