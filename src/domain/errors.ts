/**
 * Custom error types for scraper operations
 */

import { Schema } from "@effect/schema"

/** Custom Error Type for scraper operations */
export class ScraperError extends Schema.TaggedError<ScraperError>()("ScraperError", {
  reason: Schema.Literal("NavigationFailed", "Timeout", "ParsingError", "Unknown", "InvalidInput", "RateLimitExceeded"),
  message: Schema.String
}) {}

/**
 * Helper functions for creating well-formatted error messages
 */
export const ScraperErrors = {
  navigationFailed: (url: string, details: string) =>
    new ScraperError({
      reason: "NavigationFailed",
      message: `Failed to fetch flight data from Google Flights.\nURL: ${url}\nDetails: ${details}\n\nPossible solutions:\n- Check your internet connection\n- Try again in a few moments\n- Verify the airport codes are correct`
    }),

  timeout: (operation: string) =>
    new ScraperError({
      reason: "Timeout",
      message: `Operation timed out: ${operation}\n\nPossible solutions:\n- The request is taking too long, please try again\n- Check your network connection\n- Google Flights may be experiencing issues`
    }),

  parsingError: (details: string) =>
    new ScraperError({
      reason: "ParsingError",
      message: `Failed to parse flight data from the response.\nDetails: ${details}\n\nPossible solutions:\n- Google Flights may have changed their page structure\n- Try using different airports or dates\n- Report this issue if it persists`
    }),

  invalidInput: (field: string, reason: string) =>
    new ScraperError({
      reason: "InvalidInput",
      message: `Invalid input for ${field}: ${reason}\n\nPlease check:\n- Airport codes are valid (e.g., JFK, LHR)\n- Dates are in YYYY-MM-DD format\n- Return date is provided for round-trip flights\n- Passenger counts are positive numbers`
    }),

  rateLimitExceeded: (waitTimeSeconds: number) =>
    new ScraperError({
      reason: "RateLimitExceeded",
      message: `Rate limit exceeded. Too many requests in a short time.\nPlease wait ${waitTimeSeconds} seconds before trying again.\n\nNote: Google Flights limits the number of requests to prevent abuse.`
    }),

  unknown: (error: unknown) =>
    new ScraperError({
      reason: "Unknown",
      message: `An unexpected error occurred: ${String(error)}\n\nPlease try again or report this issue if it persists.`
    })
}

