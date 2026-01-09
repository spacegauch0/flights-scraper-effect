/**
 * Domain types and schemas for the Google Flights scraper
 */

import { Schema } from "@effect/schema"

/** Defines the trip type for flight searches */
export type TripType = "one-way" | "round-trip" | "multi-city"

/** Defines the seat/cabin class for flight searches */
export type SeatClass = "economy" | "premium-economy" | "business" | "first"

/** Defines passenger counts for flight searches */
export interface Passengers {
  adults: number
  children: number         // Ages 2-11
  infants_in_seat: number // Under 2, with seat
  infants_on_lap: number  // Under 2, on lap
}

/** Defines the sorting options for flight results */
export type SortOption = 
  | "price-asc"      // Price: low to high
  | "price-desc"     // Price: high to low
  | "duration-asc"   // Duration: shortest to longest
  | "duration-desc"  // Duration: longest to shortest
  | "airline"        // Airline: alphabetical
  | "none"           // No sorting (default order)

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
export interface FlightFilters {
  /** Maximum price (inclusive). Flights above this price will be excluded. */
  maxPrice?: number
  
  /** Minimum price (inclusive). Flights below this price will be excluded. */
  minPrice?: number
  
  /** Maximum duration in minutes. Flights longer than this will be excluded. */
  maxDurationMinutes?: number
  
  /** Filter by specific airlines. Only flights from these airlines will be included. */
  airlines?: string[]
  
  /** Filter by number of stops. If true, only nonstop flights are included. */
  nonstopOnly?: boolean
  
  /** Maximum number of stops (0 = nonstop, 1 = up to 1 stop, 2 = up to 2 stops) */
  max_stops?: number
  
  /** 
   * Maximum number of results to return. Applied after filtering and sorting.
   * Use "all" to automatically load all results by clicking "View more flights".
   */
  limit?: number | "all"
}

/** Legacy alias for backward compatibility */
export type Flight = FlightOption

