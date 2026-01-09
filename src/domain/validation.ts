/**
 * Input validation utilities using Effect Schema
 * 
 * Note: The Schema definitions in types.ts provide compile-time type safety and runtime validation.
 * These helper functions can be used for additional validation when needed.
 * 
 * For runtime validation, use Schema.decodeUnknown directly:
 * ```typescript
 * const result = yield* Schema.decodeUnknown(AirportCodeSchema)(code)
 * ```
 */

import { Effect } from "effect"
import { ScraperError, ScraperErrors } from "./errors"

/**
 * Basic validation helpers - Schema definitions in types.ts provide the main validation
 */

/**
 * Validates that a return date is provided for round-trip flights
 */
export const validateRoundTrip = (tripType: string, returnDate?: string): Effect.Effect<void, ScraperError> =>
  tripType === "round-trip" && !returnDate
    ? Effect.fail(ScraperErrors.invalidInput("returnDate", "Return date is required for round-trip flights"))
    : Effect.void

